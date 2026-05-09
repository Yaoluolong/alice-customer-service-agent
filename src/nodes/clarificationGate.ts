import { AgentState, RouteTarget, TraceEntry } from "../types";
import { getLastUserText } from "../utils/messages";
import { logger } from "../logger";

// --- Entity Detection ---

const ORDER_ID_PATTERN = /ORD-\d+/i;
const BRAND_PATTERN = /\b(chanel|gucci|lv|louis\s*vuitton|hermes|prada|dior|burberry)\b/i;
const PRICE_PATTERN = /\d{2,}[元块rmb¥$€]/i;

function hasEntity(text: string): boolean {
  return (
    ORDER_ID_PATTERN.test(text) ||
    BRAND_PATTERN.test(text) ||
    PRICE_PATTERN.test(text)
  );
}

// --- Intent Labels ---

const INTENT_LABELS_ZH: Record<string, string> = {
  product_inquiry: "了解某款商品",
  knowledge_query: "查询退货/售后政策",
  order_status: "查看订单状态",
  general_chat: "随便聊聊",
};

const INTENT_LABELS_EN: Record<string, string> = {
  product_inquiry: "looking for a product",
  knowledge_query: "checking our policies",
  order_status: "tracking an order",
  general_chat: "just chatting",
};

// --- Exported Pure Functions ---

/**
 * Phase A: fast-reject for extremely vague messages (before retrieval).
 * Rejects when ALL conditions met:
 * - intentConfidence < 0.4
 * - text.length < 8
 * - No entity detected
 */
export function shouldPreCheckReject(
  text: string,
  intentConfidence: number,
  _candidates: string[]
): boolean {
  if (intentConfidence >= 0.4) return false;
  if (text.length >= 8) return false;
  if (hasEntity(text)) return false;
  return true;
}

/**
 * Phase B: post-retrieval gate using retrieval quality as signal.
 * Rejects when ALL conditions met:
 * - intentConfidence < 0.5
 * - text.length < 15
 * - No entity detected
 * - topRetrievalScore < 0.4
 */
export function shouldGateReject(
  text: string,
  intentConfidence: number,
  topRetrievalScore: number
): boolean {
  if (intentConfidence >= 0.5) return false;
  if (text.length >= 15) return false;
  if (hasEntity(text)) return false;
  if (topRetrievalScore >= 0.4) return false;
  return true;
}

/**
 * Build a clarification message from top-2 intent candidates.
 * Pads with "general_chat" if fewer than 2 candidates.
 */
export function buildClarificationMessage(
  candidates: string[],
  language: string
): string {
  const isZh = language.startsWith("zh");
  const labels = isZh ? INTENT_LABELS_ZH : INTENT_LABELS_EN;

  // Ensure we have at least 2 candidates
  const padded = [...candidates];
  while (padded.length < 2) {
    padded.push("general_chat");
  }

  const optionA = labels[padded[0]] || labels["general_chat"];
  const optionB = labels[padded[1]] || labels["general_chat"];

  if (isZh) {
    return `我想确认一下，你是想${optionA}，还是${optionB}呢？`;
  }
  return `Just to make sure I help you best — are you looking for ${optionA}, or ${optionB}?`;
}

// --- Graph Nodes ---

/**
 * Phase A node: lightweight pre-check before retrieval.
 */
export function clarificationPreCheckNode(
  state: AgentState
): Partial<AgentState> {
  const text = getLastUserText(state.messages);
  const confidence = state.intent_confidence ?? 0;
  const candidates = state.intent_candidates ?? [];

  const rejected = shouldPreCheckReject(text, confidence, candidates);

  const trace: TraceEntry = {
    node: "clarification_precheck",
    displayName: "Clarification Pre-Check",
    input: text,
    output: rejected ? "rejected — asking clarification" : "passed",
    metadata: { intentConfidence: confidence, textLength: text.length },
  };

  if (rejected) {
    const message = buildClarificationMessage(candidates, state.reply_language);
    logger.info(
      { text, confidence, candidates },
      "clarification_precheck: rejected, asking clarification"
    );
    return {
      requires_clarification: true,
      draft_reply: message,
      trace: [...state.trace, trace],
    };
  }

  return {
    trace: [...state.trace, trace],
  };
}

/**
 * Phase B node: post-retrieval gate using retrieval quality.
 */
export function clarificationGateNode(
  state: AgentState
): Partial<AgentState> {
  const text = getLastUserText(state.messages);
  const confidence = state.intent_confidence ?? 0;
  const candidates = state.intent_candidates ?? [];

  // Compute top retrieval score
  let topScore = 0;
  if (state.retrieved_context) {
    const allItems = [
      ...(state.retrieved_context.products || []),
      ...(state.retrieved_context.knowledge || []),
    ];
    for (const item of allItems) {
      if (item.score > topScore) topScore = item.score;
    }
  }

  const rejected = shouldGateReject(text, confidence, topScore);

  const trace: TraceEntry = {
    node: "clarification_gate",
    displayName: "Clarification Gate",
    input: text,
    output: rejected ? "rejected — asking clarification" : "passed",
    metadata: { intentConfidence: confidence, topScore, textLength: text.length },
  };

  if (rejected) {
    const message = buildClarificationMessage(candidates, state.reply_language);
    logger.info(
      { text, confidence, topScore, candidates },
      "clarification_gate: rejected, asking clarification"
    );
    return {
      requires_clarification: true,
      draft_reply: message,
      trace: [...state.trace, trace],
    };
  }

  return {
    trace: [...state.trace, trace],
  };
}

// --- Condition Functions ---

/**
 * After pre-check: route to response_composer if clarification needed, else continue to retrieval.
 */
export function preCheckCondition(state: AgentState): string {
  return state.requires_clarification ? "response_composer" : "retrieval";
}

/**
 * After gate: route to response_composer if clarification needed, else continue to route_target.
 */
export function gateCondition(state: AgentState): string {
  return state.requires_clarification ? "response_composer" : state.route_target;
}
