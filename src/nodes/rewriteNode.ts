import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getConfiguredModel } from "../config/models";
import { logger } from "../logger";
import { AgentState, ReviewRule, TraceEntry } from "../types";
import { getLastAssistantText } from "../utils/messages";

const REWRITE_SYSTEM_PROMPT =
  "你是 AI 客服回复编辑器。用户给你一段被打回的回复和打回原因。\n" +
  "请最小化修改，只修复被标记的问题，保留其余内容不变。\n" +
  "不要改变回复的整体结构和语气。\n" +
  "直接输出修改后的回复，不需要解释。";

const buildRewriteInput = (
  draftReply: string,
  retryFeedback: string[],
  failedChecks: string[],
  customRules?: ReviewRule[]
): string => {
  const lines: string[] = [];
  lines.push(`原始回复：\n${draftReply}`);
  lines.push("");
  lines.push("打回原因：");
  for (const fb of retryFeedback) {
    lines.push(`- ${fb}`);
  }

  if (customRules && customRules.length > 0) {
    const failedRuleIds = failedChecks
      .filter((c) => c.startsWith("custom:"))
      .map((c) => c.slice("custom:".length));

    const failedRules = customRules.filter((r) => failedRuleIds.includes(r.id));
    if (failedRules.length > 0) {
      lines.push("");
      lines.push("被触发的规则详情：");
      for (const rule of failedRules) {
        const patternStr = Array.isArray(rule.pattern) ? rule.pattern.join(", ") : rule.pattern;
        lines.push(`- ${rule.name} (${rule.type}): ${patternStr}`);
      }
    }
  }

  lines.push("");
  lines.push("请输出修改后的回复，不需要解释。");
  return lines.join("\n");
};

export const rewriteNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  const draftReply = state.draft_reply ?? getLastAssistantText(state.messages);
  const retryNumber = state.reviewer_retries + 1;
  const maxRetries = state.tenant_config?.reviewerPolicy?.maxRetries ?? 0;

  const llmBase = getConfiguredModel("aux", 0);

  if (!llmBase) {
    logger.warn("rewriteNode: no LLM available, forcing retry exhaustion");
    const trace: TraceEntry = {
      node: "rewriter",
      displayName: "Response Rewriter",
      input: `Retry #${retryNumber}: no LLM available`,
      output: "Skipped — no LLM, forcing exhaustion",
      metadata: { retryNumber, skipped: true },
    };
    return {
      reviewer_retries: maxRetries,
      trace: [trace],
    };
  }

  try {
    const userInput = buildRewriteInput(
      draftReply,
      state.retry_feedback,
      state.failed_checks,
      state.tenant_config?.reviewerPolicy?.customRules
    );

    const response = await llmBase.invoke([
      new SystemMessage(REWRITE_SYSTEM_PROMPT),
      new HumanMessage(userInput),
    ]);

    const rewritten = String(response.content ?? "").trim();
    const charsDiff = Math.abs(rewritten.length - draftReply.length);

    const trace: TraceEntry = {
      node: "rewriter",
      displayName: "Response Rewriter",
      input: `Retry #${retryNumber}: fixing ${state.failed_checks.join(", ")}`,
      output: `Rewrote reply (${charsDiff} chars changed)`,
      metadata: { retryNumber, failedChecks: state.failed_checks, charsDiff },
    };

    return {
      draft_reply: rewritten,
      reviewer_retries: retryNumber,
      trace: [trace],
    };
  } catch (err) {
    logger.warn({ err }, "rewriteNode: LLM rewrite failed, forcing retry exhaustion");
    const trace: TraceEntry = {
      node: "rewriter",
      displayName: "Response Rewriter",
      input: `Retry #${retryNumber}: LLM failed`,
      output: "Skipped — LLM error, forcing exhaustion",
      metadata: { retryNumber, error: true },
    };
    return {
      reviewer_retries: maxRetries,
      trace: [trace],
    };
  }
};
