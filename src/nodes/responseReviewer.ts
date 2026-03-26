import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { appConfig } from "../config/env";
import { getConfiguredModel } from "../config/models";
import { BANNED_MECHANICAL_PHRASES, buildReviewerSystemPrompt } from "../config/persona";
import { logger } from "../logger";
import { AgentState } from "../types";
import { getLastAssistantText } from "../utils/messages";

const reviewSchema = z.object({
  score: z.number().min(0).max(1),
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

  const normalizedScore = clamp(score, 0, 1);
  return {
    score: normalizedScore,
    flags,
    reasons,
    must_handoff: normalizedScore < appConfig.confidence.threshold
  };
};

const parseReviewPayload = (raw: string): ReviewPayload => {
  const json = extractJsonObject(raw);
  if (!json) {
    throw new Error("review output does not contain JSON object");
  }
  const parsed = JSON.parse(json) as unknown;
  return reviewSchema.parse(parsed);
};

export const responseReviewerNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  const reply = state.draft_reply ?? getLastAssistantText(state.messages);

  const llm = getConfiguredModel("aux", 0);
  let payload: ReviewPayload;
  let trace = "review:heuristic";

  if (!llm) {
    payload = heuristicReview(state, reply);
  } else {
    try {
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
      trace = "review:model";
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "response-reviewer LLM review failed, falling back to heuristic");
      payload = heuristicReview(state, reply);
      payload.flags.push("llm_review_fallback");
      trace = "review:llm-failed-heuristic-fallback";
    }
  }

  return {
    agent_confidence: clamp(payload.score, 0, 1),
    review_flags: payload.flags,
    confidence_reasons: payload.reasons,
    requires_human: state.requires_human || payload.must_handoff,
    handoff_reason: payload.must_handoff ? payload.reasons[0] ?? "自动审校判定需要人工介入" : state.handoff_reason,
    trace: [trace]
  };
};

export { parseReviewPayload };
