import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { appConfig } from "../config/env";
import { getConfiguredModel } from "../config/models";
import { BANNED_MECHANICAL_PHRASES, buildReviewerSystemPrompt } from "../config/persona";
import { logger } from "../logger";
import { AgentState, ReviewDimension, ReviewRule, TraceEntry } from "../types";
import { getLastAssistantText, getLastUserText } from "../utils/messages";

const reviewSchema = z.object({
  score: z.coerce.number().min(0).max(1),
  flags: z.array(z.string()).default([]),
  reasons: z.array(z.string()).default([]),
  must_handoff: z.boolean().default(false)
});

type ReviewPayload = z.infer<typeof reviewSchema>;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const getThreshold = (state: AgentState): number =>
  state.tenant_config?.confidenceThreshold ?? appConfig.confidence.threshold;

/** Map heuristic flag IDs back to ReviewDimension IDs (for incremental review on retry) */
const FLAG_TO_DIMENSION: Record<string, ReviewDimension> = {
  no_grounding_facts: "grounding_facts",
  contains_unknowns: "unknowns",
  too_short: "length",
  mechanical_phrase: "mechanical_phrase",
  repetitive_opening: "repetitive_opening",
  incomplete_answer: "completeness",
  incoherent: "coherence",
  tone_mismatch: "tone_match",
};

const isDimensionEnabled = (dim: ReviewDimension, state: AgentState): boolean => {
  const enabled = state.tenant_config?.reviewerPolicy?.enabledDimensions;
  if (!enabled) return true;
  return enabled.includes(dim);
};

const shouldCheckDim = (dim: ReviewDimension, state: AgentState, checkOnly?: string[]): boolean => {
  if (!isDimensionEnabled(dim, state)) return false;
  if (!checkOnly) return true;
  return checkOnly.some((flagId) => FLAG_TO_DIMENSION[flagId] === dim);
};

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

const heuristicReview = (state: AgentState, reply: string, checkOnly?: string[]): ReviewPayload => {
  const flags: string[] = [];
  const reasons: string[] = [];
  let score = state.grounding_facts?.fact_confidence ?? 0.55;

  if (shouldCheckDim("grounding_facts", state, checkOnly)) {
    if (!state.grounding_facts || state.grounding_facts.facts.length === 0) {
      score -= 0.25;
      flags.push("no_grounding_facts");
      reasons.push("缺少可核验事实");
    }
  }

  if (shouldCheckDim("unknowns", state, checkOnly)) {
    if ((state.grounding_facts?.unknowns.length ?? 0) > 0) {
      score -= 0.12;
      flags.push("contains_unknowns");
      reasons.push("存在不确定信息");
    }
  }

  if (shouldCheckDim("length", state, checkOnly)) {
    if (reply.trim().length < 20) {
      score -= 0.08;
      flags.push("too_short");
      reasons.push("回复过短，信息量不足");
    }
  }

  if (shouldCheckDim("mechanical_phrase", state, checkOnly)) {
    const lower = reply.toLowerCase();
    const hitMechanical = BANNED_MECHANICAL_PHRASES.some((phrase) => lower.includes(phrase.toLowerCase()));
    if (hitMechanical) {
      score -= 0.2;
      flags.push("mechanical_phrase");
      reasons.push("检测到机械化表达");
    }
  }

  if (shouldCheckDim("repetitive_opening", state, checkOnly)) {
    if (state.variation_id && state.recent_opening_templates.filter((id) => id === state.variation_id).length > 1) {
      score -= 0.1;
      flags.push("repetitive_opening");
      reasons.push("开场表达重复");
    }
  }

  const lastUserMsg = getLastUserText(state.messages ?? []);

  if (shouldCheckDim("completeness", state, checkOnly)) {
    const completePenalty = heuristicCompleteness(lastUserMsg, reply);
    if (completePenalty < 0) { score += completePenalty; flags.push("incomplete_answer"); reasons.push("未完整回答所有问题"); }
  }

  if (shouldCheckDim("coherence", state, checkOnly)) {
    const coherencePenalty = heuristicCoherence(state.conversation_summary, reply);
    if (coherencePenalty < 0) { score += coherencePenalty; flags.push("incoherent"); reasons.push("与对话历史不连贯"); }
  }

  if (shouldCheckDim("tone_match", state, checkOnly)) {
    const tonePenalty = heuristicToneMatch(state.tone_applied, reply);
    if (tonePenalty < 0) { score += tonePenalty; flags.push("tone_mismatch"); reasons.push("语气与用户情绪不匹配"); }
  }

  const normalizedScore = clamp(score, 0, 1);
  return {
    score: normalizedScore,
    flags,
    reasons,
    must_handoff: normalizedScore < getThreshold(state)
  };
};

interface CustomRuleResult {
  ruleId: string;
  triggered: boolean;
  action: "penalty" | "hard_reject";
  penaltyScore: number;
  reason: string;
}

const evaluateKeywordRule = (rule: ReviewRule, reply: string): boolean => {
  const patterns = rule.pattern as string[];
  const lower = reply.toLowerCase();
  const hasMatch = patterns.some((kw) => lower.includes(kw.toLowerCase()));
  const mode = rule.mode ?? "must_not_contain";
  return mode === "must_not_contain" ? hasMatch : !hasMatch;
};

const evaluateRegexRule = (rule: ReviewRule, reply: string): boolean => {
  try {
    const re = new RegExp(rule.pattern as string, "i");
    const hasMatch = re.test(reply);
    const mode = rule.mode ?? "must_not_contain";
    return mode === "must_not_contain" ? hasMatch : !hasMatch;
  } catch {
    return false;
  }
};

const evaluateCustomRules = (
  rules: ReviewRule[] | undefined,
  reply: string,
  checkOnly?: string[]
): CustomRuleResult[] => {
  if (!rules || rules.length === 0) return [];
  const results: CustomRuleResult[] = [];
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    if (rule.type === "semantic") continue;
    if (checkOnly && !checkOnly.includes(`custom:${rule.id}`)) continue;

    let triggered = false;
    if (rule.type === "keyword") {
      triggered = evaluateKeywordRule(rule, reply);
    } else if (rule.type === "regex") {
      triggered = evaluateRegexRule(rule, reply);
    }

    if (triggered) {
      results.push({
        ruleId: rule.id,
        triggered: true,
        action: rule.action,
        penaltyScore: rule.action === "penalty" ? (rule.penaltyScore ?? -0.15) : 0,
        reason: `自定义规则「${rule.name}」触发`,
      });
    }
  }
  return results;
};

const semanticResultSchema = z.object({
  results: z.array(z.object({
    ruleId: z.string(),
    passed: z.boolean(),
    reason: z.string().default(""),
  })),
});

const evaluateSemanticRules = async (
  rules: ReviewRule[],
  reply: string,
  checkOnly?: string[]
): Promise<CustomRuleResult[]> => {
  const semanticRules = rules.filter(
    (r) => r.type === "semantic" && r.enabled !== false &&
      (!checkOnly || checkOnly.includes(`custom:${r.id}`))
  );
  if (semanticRules.length === 0) return [];

  const llmBase = getConfiguredModel("aux", 0);
  if (!llmBase) return [];

  try {
    const llm = llmBase.bind({ response_format: { type: "json_object" } });
    const ruleDescriptions = semanticRules
      .map((r) => `- ruleId: "${r.id}", name: "${r.name}", instruction: "${r.pattern as string}"`)
      .join("\n");

    const response = await llm.invoke([
      new SystemMessage(
        "你是回复质量审核员。检查以下 AI 客服回复是否符合规则。\n" +
        "对每条规则返回 pass/fail 和简短理由。\n\n" +
        `规则列表：\n${ruleDescriptions}\n\n` +
        '返回 JSON: { "results": [{ "ruleId": "xxx", "passed": true/false, "reason": "..." }] }'
      ),
      new HumanMessage(`回复内容：\n${reply}`),
    ]);

    const parsed = semanticResultSchema.parse(
      JSON.parse(extractJsonObject(String(response.content ?? "")) ?? "{}")
    );

    return parsed.results
      .filter((r) => !r.passed)
      .map((r) => {
        const rule = semanticRules.find((sr) => sr.id === r.ruleId);
        return {
          ruleId: r.ruleId,
          triggered: true,
          action: rule?.action ?? "penalty",
          penaltyScore: rule?.action === "penalty" ? (rule.penaltyScore ?? -0.15) : 0,
          reason: r.reason || `语义规则「${rule?.name ?? r.ruleId}」触发`,
        };
      });
  } catch (err) {
    logger.warn({ err }, "semantic rule LLM evaluation failed, skipping semantic rules");
    return [];
  }
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

  const checkOnly = state.reviewer_retries > 0 ? state.failed_checks : undefined;

  if (!llmBase) {
    payload = heuristicReview(state, reply, checkOnly);
  } else {
    try {
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
      // Post-filter LLM results: strip flags for disabled dimensions
      const enabledDims = state.tenant_config?.reviewerPolicy?.enabledDimensions;
      if (enabledDims) {
        const disabledFlags = Object.entries(FLAG_TO_DIMENSION)
          .filter(([, dim]) => !enabledDims.includes(dim))
          .map(([flag]) => flag);
        payload.flags = payload.flags.filter((f) => !disabledFlags.includes(f));
        payload.reasons = payload.reasons.slice(0, payload.flags.length);
      }
      method = "llm";
    } catch (err) {
      const e = err as Error & { status?: number; code?: string };
      logger.warn(
        { errType: e.constructor?.name, errMsg: e.message, status: e.status, code: e.code },
        "response-reviewer LLM review failed, falling back to heuristic"
      );
      payload = heuristicReview(state, reply, checkOnly);
      payload.flags.push("llm_review_fallback");
      method = "heuristic";
    }
  }

  // Evaluate custom keyword/regex rules
  const customRules = state.tenant_config?.reviewerPolicy?.customRules;
  const ruleResults = evaluateCustomRules(customRules, reply, checkOnly);

  let hasHardReject = false;
  for (const result of ruleResults) {
    const flagId = `custom:${result.ruleId}`;
    payload.flags.push(flagId);
    payload.reasons.push(result.reason);
    if (result.action === "penalty") {
      payload.score = clamp(payload.score + result.penaltyScore, 0, 1);
    } else {
      hasHardReject = true;
    }
  }

  // Re-evaluate must_handoff with custom rules factored in
  if (hasHardReject) {
    payload.must_handoff = true;
  } else {
    payload.must_handoff = payload.score < getThreshold(state);
  }

  // Early exit: skip semantic LLM call if hard_reject already triggered
  if (!hasHardReject) {
    const semanticResults = await evaluateSemanticRules(
      customRules ?? [],
      reply,
      checkOnly
    );
    for (const result of semanticResults) {
      const flagId = `custom:${result.ruleId}`;
      payload.flags.push(flagId);
      payload.reasons.push(result.reason);
      if (result.action === "penalty") {
        payload.score = clamp(payload.score + result.penaltyScore, 0, 1);
      } else {
        hasHardReject = true;
      }
    }
    if (hasHardReject) {
      payload.must_handoff = true;
    } else {
      payload.must_handoff = payload.score < getThreshold(state);
    }
  }

  const failedChecks = payload.flags.filter((f) => f !== "llm_review_fallback");
  const retryFeedback = payload.reasons.slice();

  const suggestions = payload.flags
    .map((f) => FLAG_SUGGESTIONS[f])
    .filter(Boolean) as string[];

  const reviewerTrace: TraceEntry = {
    node: "reviewer",
    displayName: "Response Reviewer",
    input: `Reviewing draft reply (${reply.length} chars)${state.reviewer_retries > 0 ? ` [retry #${state.reviewer_retries}]` : ""}`,
    output: `Score: ${payload.score.toFixed(2)} — ${payload.flags.length ? payload.flags.join(", ") : "no issues"}`,
    metadata: {
      score: payload.score,
      flags: payload.flags,
      method,
      severity: payload.flags.length > 0 ? "warn" : "ok",
      suggestions,
      retryNumber: state.reviewer_retries,
    },
  };

  return {
    agent_confidence: clamp(payload.score, 0, 1),
    review_flags: payload.flags,
    confidence_reasons: payload.reasons,
    requires_human: state.reviewer_retries > 0
      ? payload.must_handoff
      : (state.requires_human || payload.must_handoff),
    handoff_reason: payload.must_handoff ? payload.reasons[0] ?? "自动审校判定需要人工介入" : state.handoff_reason,
    failed_checks: failedChecks,
    retry_feedback: retryFeedback,
    trace: [reviewerTrace]
  };
};

