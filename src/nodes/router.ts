import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getConfiguredModel } from "../config/models";
import { buildRouterSystemPrompt } from "../config/persona";
import { AgentState, RouteTarget, TenantAgentConfig, TraceEntry, UserIntent } from "../types";
import { getLastUserText } from "../utils/messages";

// --- Conversation Closing Detection (Layer 0.5) ---

const CLOSING_PHRASES_ZH = [
  "好的谢谢", "谢谢你", "没有了", "没别的了",
  "就这样", "好的就这样", "不用了谢谢", "可以了谢谢",
];

const CLOSING_PHRASES_EN = [
  "thanks that's all", "thank you bye", "no that's it",
  "nothing else thanks", "goodbye", "bye bye",
];

const ALL_CLOSING_PHRASES = [...CLOSING_PHRASES_ZH, ...CLOSING_PHRASES_EN];

/**
 * Detect whether the user message is a conversation-closing phrase.
 * Multi-word phrase match only — standalone "谢谢" or "thanks" do NOT trigger.
 */
export const isConversationClosing = (text: string): boolean => {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return ALL_CLOSING_PHRASES.some((phrase) => normalized === phrase.toLowerCase());
};

// --- Intent Stack ---

const INTENT_STACK_MAX_DEPTH = 3;
const INTENT_INHERIT_THRESHOLD = 0.3;

export interface IntentStackResult {
  stack: string[];
  inherited: boolean;
  inheritedTarget?: string;
}

export function updateIntentStack(
  currentStack: string[],
  newTarget: string,
  confidence: number
): IntentStackResult {
  if (confidence >= INTENT_INHERIT_THRESHOLD || currentStack.length === 0) {
    const stack = [...currentStack];
    if (stack[stack.length - 1] !== newTarget) {
      stack.push(newTarget);
      if (stack.length > INTENT_STACK_MAX_DEPTH) stack.shift();
    }
    return { stack, inherited: false };
  }
  return {
    stack: [...currentStack],
    inherited: true,
    inheritedTarget: currentStack[currentStack.length - 1],
  };
}

// --- Confidence-aware Heuristic Classification ---

export interface ClassificationResult {
  intent: UserIntent;
  confidence: number;
  candidates: string[];
}

const DEFAULT_KEYWORDS: Record<string, string[]> = {
  knowledge_query: [
    "退货", "退换", "退款", "保修", "保修期", "售后",
    "运费", "包邮", "配送", "物流政策",
    "政策", "规则", "条款", "常见问题",
    "return", "refund", "warranty", "shipping policy", "policy", "faq"
  ],
  order_status: ["订单", "快递", "发货了吗", "催单", "查订单", "order", "tracking", "shipment"],
  product_inquiry: ["商品", "风衣", "颜色", "尺码", "库存", "推荐", "有吗", "多少钱", "包包", "手袋", "包", "箱", "鞋", "外套", "连衣裙", "想看", "有没有", "Chanel", "LV", "Gucci", "Prada", "Hermes", "product", "size", "stock", "price", "bag", "handbag"],
  general_chat: ["你好", "谢谢", "再见", "聊聊", "hello", "thanks", "hi"],
};

export const heuristicClassifyWithConfidence = (
  text: string,
  hasMedia: boolean,
  keywordOverrides?: Record<string, string[]>
): ClassificationResult => {
  if (hasMedia) {
    return { intent: UserIntent.VISUAL_SEARCH, confidence: 0.8, candidates: ["visual_search"] };
  }

  const keywords = keywordOverrides
    ? { ...DEFAULT_KEYWORDS, ...keywordOverrides }
    : DEFAULT_KEYWORDS;

  // Count matches per category
  const matchCounts: Record<string, number> = {};
  for (const [category, kws] of Object.entries(keywords)) {
    const count = kws.filter((kw) => text.includes(kw)).length;
    if (count > 0) matchCounts[category] = count;
  }

  const matchedCategories = Object.keys(matchCounts);
  // Priority tiebreaker: when two intents have equal match counts,
  // prefer knowledge_query over order_status (e.g. "退款" should route to knowledge)
  const INTENT_PRIORITY: Record<string, number> = {
    knowledge_query: 0,
    order_status: 1,
    product_inquiry: 2,
    general_chat: 3,
  };

  // Top-3 sorted by match count descending, then by priority ascending
  const candidates = Object.entries(matchCounts)
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1]; // higher count first
      return (INTENT_PRIORITY[a[0]] ?? 99) - (INTENT_PRIORITY[b[0]] ?? 99); // priority tiebreak
    })
    .slice(0, 3)
    .map(([cat]) => cat);

  if (matchedCategories.length === 0) {
    return { intent: UserIntent.UNKNOWN, confidence: 0.2, candidates: [] };
  }

  const topCategory = candidates[0];
  const confidence = matchedCategories.length === 1 ? 0.8 : 0.4;

  // Map category string to UserIntent
  const categoryToIntent: Record<string, UserIntent> = {
    knowledge_query: UserIntent.KNOWLEDGE_QUERY,
    order_status: UserIntent.ORDER_STATUS,
    product_inquiry: UserIntent.PRODUCT_INQUIRY,
    general_chat: UserIntent.GENERAL_CHAT,
  };

  const intent = categoryToIntent[topCategory] ?? UserIntent.UNKNOWN;
  return { intent, confidence, candidates };
};

/** Legacy wrapper — keeps classifyIntent compatible */
const heuristicClassify = (
  text: string,
  hasMedia: boolean,
  keywordOverrides?: Record<string, string[]>
): UserIntent => {
  return heuristicClassifyWithConfidence(text, hasMedia, keywordOverrides).intent;
};

const classifyIntent = async (
  text: string,
  hasMedia: boolean,
  mediaType?: string,
  keywordOverrides?: Record<string, string[]>,
  soulPrompt?: string,
  language?: string,
  routerInstruction?: string
): Promise<UserIntent> => {
  const llm = getConfiguredModel("aux", 0);
  if (!llm) return heuristicClassify(text, hasMedia, keywordOverrides);

  try {
    const response = await llm.invoke([
      new SystemMessage(await buildRouterSystemPrompt(soulPrompt, language, routerInstruction)),
      new HumanMessage(`has_media=${hasMedia}; media_type=${mediaType ?? "none"}; text=${text}`)
    ]);
    const normalized = String(response.content).trim().toLowerCase();
    if (normalized.includes("visual_search")) return UserIntent.VISUAL_SEARCH;
    if (normalized.includes("knowledge_query")) return UserIntent.KNOWLEDGE_QUERY;
    if (normalized.includes("product_inquiry")) return UserIntent.PRODUCT_INQUIRY;
    if (normalized.includes("order_status")) return UserIntent.ORDER_STATUS;
    if (normalized.includes("general_chat")) return UserIntent.GENERAL_CHAT;
    return UserIntent.UNKNOWN;
  } catch {
    return heuristicClassify(text, hasMedia, keywordOverrides);
  }
};

const DEFAULT_INTENT_MAPPING: Record<UserIntent, RouteTarget> = {
  [UserIntent.VISUAL_SEARCH]: RouteTarget.VISUAL_AGENT,
  [UserIntent.VIDEO_SEARCH]: RouteTarget.VISUAL_AGENT,
  [UserIntent.PRODUCT_INQUIRY]: RouteTarget.SALES_AGENT,
  [UserIntent.ORDER_STATUS]: RouteTarget.ORDER_AGENT,
  [UserIntent.KNOWLEDGE_QUERY]: RouteTarget.KNOWLEDGE_AGENT,
  [UserIntent.GENERAL_CHAT]: RouteTarget.CHAT_AGENT,
  [UserIntent.UNKNOWN]: RouteTarget.CHAT_AGENT,
};

const isEnabled = (
  target: RouteTarget,
  enabled: RouteTarget[] | undefined,
  fallback: RouteTarget
): RouteTarget => {
  if (!enabled || enabled.length === 0 || enabled.includes(target)) return target;
  if (enabled.includes(fallback)) return fallback;
  return RouteTarget.CHAT_AGENT;
};

const resolveTarget = (
  intent: UserIntent,
  hasMedia: boolean,
  tenantConfig?: TenantAgentConfig | null
): RouteTarget => {
  const policy = tenantConfig?.routingPolicy;
  const enabled = tenantConfig?.enabledAgents;
  const defaultAgent = policy?.defaultAgent ?? RouteTarget.CHAT_AGENT;

  // Layer 0: Hard rules — media always goes to visual
  if (hasMedia || intent === UserIntent.VISUAL_SEARCH || intent === UserIntent.VIDEO_SEARCH) {
    return isEnabled(RouteTarget.VISUAL_AGENT, enabled, defaultAgent);
  }

  // Layer 2: Check tenant intentMapping override first
  const overrideTarget = policy?.intentMapping?.[intent];
  if (overrideTarget) {
    return isEnabled(overrideTarget, enabled, defaultAgent);
  }

  // Layer 2 fallback: system default mapping (for non-fallback intents)
  if (intent !== UserIntent.GENERAL_CHAT && intent !== UserIntent.UNKNOWN) {
    const systemTarget = DEFAULT_INTENT_MAPPING[intent];
    if (systemTarget) {
      return isEnabled(systemTarget, enabled, defaultAgent);
    }
  }

  // Layer 3: Default agent for general_chat / unknown
  return isEnabled(defaultAgent, enabled, RouteTarget.CHAT_AGENT);
};

export const routerNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  const text = getLastUserText(state.messages);
  const hasMedia = Boolean(state.media_context ?? state.image_context);
  const mediaType = state.media_context?.mediaType;
  const tenantConfig = state.tenant_config;

  // Layer 0: Hard rules — media always goes to visual (checked first in resolveTarget)
  // Layer 0.5: Conversation closing detection (after media check, before classification)
  if (!hasMedia && isConversationClosing(text)) {
    const traceEntry: TraceEntry = {
      node: "router",
      displayName: "Intent Router",
      input: text.slice(0, 80),
      output: `Detected: conversation_closing → ${RouteTarget.CONVERSATION_CLOSING} (heuristic)`,
      metadata: {
        intent: "conversation_closing",
        target: RouteTarget.CONVERSATION_CLOSING,
        method: "heuristic",
        severity: "ok",
        suggestions: [],
      },
    };
    return {
      route_target: RouteTarget.CONVERSATION_CLOSING,
      intent_confidence: 0.9,
      intent_candidates: ["conversation_closing"],
      intent_stack: [],
      conversation_closing: true,
      trace: [traceEntry],
    };
  }

  const llm = getConfiguredModel("aux", 0);
  const method = llm ? "llm" : "heuristic";

  // Classify with confidence
  let intent: UserIntent;
  let intentConfidence: number;
  let intentCandidates: string[];

  if (llm) {
    intent = await classifyIntent(
      text, hasMedia, mediaType,
      tenantConfig?.routerKeywords,
      tenantConfig?.soulPrompt,
      tenantConfig?.defaultLanguage ?? state.reply_language,
      tenantConfig?.routingPolicy?.routerInstruction
    );
    // LLM classification gets high confidence
    intentConfidence = 0.85;
    intentCandidates = [intent];
  } else {
    const result = heuristicClassifyWithConfidence(text, hasMedia, tenantConfig?.routerKeywords);
    intent = result.intent;
    intentConfidence = result.confidence;
    intentCandidates = result.candidates;
  }

  let target = resolveTarget(intent, hasMedia, tenantConfig);

  const isUnknown = intent === UserIntent.UNKNOWN;
  const traceEntry: TraceEntry = {
    node: "router",
    displayName: "Intent Router",
    input: text.slice(0, 80),
    output: `Detected: ${intent} → ${target} (${method})`,
    metadata: {
      intent,
      target,
      method,
      intentConfidence,
      intentCandidates,
      severity: isUnknown ? "warn" : "ok",
      suggestions: isUnknown ? ["Intent not recognized, using default route"] : [],
    },
  };

  // Intent stack logic
  const stackResult = updateIntentStack(
    state.intent_stack ?? [],
    target,
    intentConfidence
  );

  if (stackResult.inherited) {
    target = stackResult.inheritedTarget!;
    intentConfidence = 1.0;
    traceEntry.metadata.inherited = true;
    traceEntry.metadata.inheritedFrom = stackResult.inheritedTarget;
  }

  const finalStack = stackResult.stack;

  return {
    user_intent: intent,
    route_target: target,
    intent_confidence: intentConfidence,
    intent_candidates: intentCandidates,
    intent_stack: finalStack,
    requires_human: target === RouteTarget.HUMAN_HANDOFF,
    trace: [traceEntry]
  };
};

export const routerCondition = (state: AgentState): string => state.route_target;
