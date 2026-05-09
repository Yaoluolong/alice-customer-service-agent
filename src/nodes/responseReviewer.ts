import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { appConfig } from "../config/env";
import { getConfiguredModel } from "../config/models";
import { BANNED_MECHANICAL_PHRASES, buildReviewerSystemPrompt } from "../config/persona";
import { logger } from "../logger";
import { AgentState, TraceEntry } from "../types";
import { getLastAssistantText, getLastUserText } from "../utils/messages";

const reviewSchema = z.object({
  score: z.coerce.number().min(0).max(1),
  flags: z.array(z.string()).default([]),
  reasons: z.array(z.string()).default([]),
  must_handoff: z.boolean().default(false)
});

type ReviewPayload = z.infer<typeof reviewSchema>;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const extractJsonObject = (text: string): string | null => {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1);
  }
  return null;
};

const parseReviewPayload = (raw: string): ReviewPayload => {
  const json = extractJsonObject(raw);
  if (!json) {
    throw new Error("review output does not contain JSON object");
  }
  const parsed = JSON.parse(json) as unknown;
  return reviewSchema.parse(parsed);
};

export function heuristicCompleteness(userMessage: string, reply: string): number {
  const questionCount = (userMessage.match(/[?？]/g) ?? []).length;
  if (questionCount === 0) return 0;
  const segments = reply.split(/[。.!！\n]/).filter((s) => s.trim().length > 5).length;
  if (segments >= questionCount) return 0;
  return -0.15;
}

export function heuristicCoherence(conversationSummary: string | null, reply: string): number {
  if (!conversationSummary || conversationSummary.length < 10) return 0;
  const keyTerms = conversationSummary.match(/[\u4e00-\u9fff]{2,}|[a-zA-Z]{4,}/g) ?? [];
  if (keyTerms.length === 0) return 0;
  const hasOverlap = keyTerms.some((term) => reply.includes(term));
  return hasOverlap ? 0 : -0.08;
}

export function heuristicToneMatch(toneApplied: string | null, reply: string): number {
  if (!toneApplied || toneApplied === "neutral") return 0;
  if (toneApplied === "urgent") {
    const casualPatterns = /慢慢|不着急|不急|take your time|no rush/i;
    if (casualPatterns.test(reply)) return -0.10;
  }
  return 0;
}

const heuristicReview = (state: AgentState, reply: string): ReviewPayload => {
  const flags: string[] = [];
  const reasons: string[] = [];

  let score = state.grounding_facts?.fact_confidence ?? 0.55;

  if (!state.grounding_facts || state.grounding_facts.facts.length === 0) {
    score -= 0.25;
    flags.push("no_grounding_facts");
    reasons.push("缺少可核验事实");
  }

  if ((state.grounding_facts?.unknowns.length ?? 0) > 0) {
    score -= 0.12;
    flags.push("contains_unknowns");
    reasons.push("存在不确定信息");
  }

  if (reply.trim().length < 20) {
    score -= 0.08;
    flags.push("too_short");
    reasons.push("回复过短，信息量不足");
  }

  const lower = reply.toLowerCase();
  const hitMechanical = BANNED_MECHANICAL_PHRASES.some((phrase) => lower.includes(phrase.toLowerCase()));
  if (hitMechanical) {
    score -= 0.2;
    flags.push("mechanical_phrase");
    reasons.push("检测到机械化表达");
  }

  if (state.variation_id && state.recent_opening_templates.filter((id) => id === state.variation_id).length > 1) {
    score -= 0.1;
    flags.push("repetitive_opening");
    reasons.push("开场表达重复");
  }

  // New dimensions
  const lastUserMsg = getLastUserText(state.messages ?? []);

  const completePenalty = heuristicCompleteness(lastUserMsg, reply);
  if (completePenalty < 0) { score += completePenalty; flags.push("incomplete_answer"); reasons.push("未完整回答所有问题"); }

  const coherencePenalty = heuristicCoherence(state.conversation_summary, reply);
  if (coherencePenalty < 0) { score += coherencePenalty; flags.push("incoherent"); reasons.push("与对话历史不连贯"); }

  const tonePenalty = heuristicToneMatch(state.tone_applied, reply);
  if (tonePenalty < 0) { score += tonePenalty; flags.push("tone_mismatch"); reasons.push("语气与用户情绪不匹配"); }

  const normalizedScore = clamp(score, 0, 1);
  return {
    score: normalizedScore,
    flags,
    reasons,
    must_handoff: normalizedScore < appConfig.confidence.threshold
  };
};

const FLAG_SUGGESTIONS: Record<string, string> = {
  no_grounding_facts: "Add product/knowledge data to improve grounding",
  contains_unknowns: "Response contains uncertain information",
  too_short: "Response may be too brief",
  mechanical_phrase: "Response sounds robotic, adjust soul prompt",
  repetitive_opening: "Opening repeats recent pattern",
  incomplete_answer: "Response does not address all user questions",
  incoherent: "Response seems unrelated to conversation context",
  tone_mismatch: "Response tone conflicts with user emotion",
  llm_review_fallback: "LLM review failed, used heuristic fallback",
};

export const responseReviewerNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  const reply = state.draft_reply ?? getLastAssistantText(state.messages);

  const llmBase = getConfiguredModel("aux", 0);
  let payload: ReviewPayload;
  let method = "heuristic";

  if (!llmBase) {
    payload = heuristicReview(state, reply);
  } else {
    try {
      // Use response_format json_object to force valid JSON output from the model.
      // withStructuredOutput is not used as it relies on tool-calling which some
      // OpenAI-compatible providers (e.g. Moonshot) reject.
      const llm = llmBase.bind({ response_format: { type: "json_object" } });
      const response = await llm.invoke([
        new SystemMessage(await buildReviewerSystemPrompt(state.reply_language, state.tenant_config?.soulPrompt)),
        new HumanMessage(
          JSON.stringify({
            reply,
            language: state.reply_language,
            grounding_facts: state.grounding_facts,
            variation_id: state.variation_id,
            recent_opening_templates: state.recent_opening_templates
          })
        )
      ]);
      payload = parseReviewPayload(String(response.content ?? ""));
      method = "llm";
    } catch (err) {
      const e = err as Error & { status?: number; code?: string };
      logger.warn(
        { errType: e.constructor?.name, errMsg: e.message, status: e.status, code: e.code },
        "response-reviewer LLM review failed, falling back to heuristic"
      );
      payload = heuristicReview(state, reply);
      payload.flags.push("llm_review_fallback");
      method = "heuristic";
    }
  }

  const suggestions = payload.flags
    .map((f) => FLAG_SUGGESTIONS[f])
    .filter(Boolean) as string[];

  const reviewerTrace: TraceEntry = {
    node: "reviewer",
    displayName: "Response Reviewer",
    input: `Reviewing draft reply (${reply.length} chars)`,
    output: `Score: ${payload.score.toFixed(2)} — ${payload.flags.length ? payload.flags.join(", ") : "no issues"}`,
    metadata: {
      score: payload.score,
      flags: payload.flags,
      method,
      severity: payload.flags.length > 0 ? "warn" : "ok",
      suggestions,
    },
  };

  return {
    agent_confidence: clamp(payload.score, 0, 1),
    review_flags: payload.flags,
    confidence_reasons: payload.reasons,
    requires_human: state.requires_human || payload.must_handoff,
    handoff_reason: payload.must_handoff ? payload.reasons[0] ?? "自动审校判定需要人工介入" : state.handoff_reason,
    trace: [reviewerTrace]
  };
};

