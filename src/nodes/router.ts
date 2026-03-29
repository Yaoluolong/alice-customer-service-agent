import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getConfiguredModel } from "../config/models";
import { buildRouterSystemPrompt } from "../config/persona";
import { AgentState, RouteTarget, TenantAgentConfig, UserIntent } from "../types";
import { getLastUserText } from "../utils/messages";

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

const heuristicClassify = (
  text: string,
  hasMedia: boolean,
  keywordOverrides?: Record<string, string[]>
): UserIntent => {
  if (hasMedia) return UserIntent.VISUAL_SEARCH;

  const keywords = keywordOverrides
    ? { ...DEFAULT_KEYWORDS, ...keywordOverrides }
    : DEFAULT_KEYWORDS;

  const matchesAny = (intentKeywords: string[]): boolean =>
    intentKeywords.some((kw) => text.includes(kw));

  // knowledge_query checked before order_status to avoid "退款" matching order_status first
  if (matchesAny(keywords.knowledge_query ?? [])) return UserIntent.KNOWLEDGE_QUERY;
  if (matchesAny(keywords.order_status ?? [])) return UserIntent.ORDER_STATUS;
  if (matchesAny(keywords.product_inquiry ?? [])) return UserIntent.PRODUCT_INQUIRY;
  if (matchesAny(keywords.general_chat ?? [])) return UserIntent.GENERAL_CHAT;
  return UserIntent.UNKNOWN;
};

const classifyIntent = async (
  text: string,
  hasMedia: boolean,
  mediaType?: string,
  keywordOverrides?: Record<string, string[]>,
  soulPrompt?: string
): Promise<UserIntent> => {
  const llm = getConfiguredModel("aux", 0);
  if (!llm) return heuristicClassify(text, hasMedia, keywordOverrides);

  try {
    const response = await llm.invoke([
      new SystemMessage(await buildRouterSystemPrompt(soulPrompt)),
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

const resolveTarget = (
  intent: UserIntent,
  hasMedia: boolean,
  tenantConfig?: TenantAgentConfig | null
): RouteTarget => {
  let target: RouteTarget;

  if (hasMedia || intent === UserIntent.VISUAL_SEARCH || intent === UserIntent.VIDEO_SEARCH) {
    target = RouteTarget.VISUAL_AGENT;
  } else if (intent === UserIntent.ORDER_STATUS) {
    target = RouteTarget.ORDER_AGENT;
  } else if (intent === UserIntent.KNOWLEDGE_QUERY) {
    target = RouteTarget.KNOWLEDGE_AGENT;
  } else if (intent === UserIntent.GENERAL_CHAT) {
    target = RouteTarget.CHAT_AGENT;
  } else if (intent === UserIntent.PRODUCT_INQUIRY) {
    target = RouteTarget.SALES_AGENT;
  } else {
    return RouteTarget.HUMAN_HANDOFF; // UNKNOWN always reaches human handoff
  }

  // Enforce enabledAgents: if this agent is disabled by the tenant, fallback to chat_agent.
  // HUMAN_HANDOFF is never blocked by enabledAgents.
  const enabled = tenantConfig?.enabledAgents;
  if (enabled && enabled.length > 0 && !enabled.includes(target)) {
    return RouteTarget.CHAT_AGENT;
  }

  return target;
};

export const routerNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  const text = getLastUserText(state.messages);
  const hasMedia = Boolean(state.media_context ?? state.image_context);
  const mediaType = state.media_context?.mediaType;
  const tenantConfig = state.tenant_config;
  const intent = await classifyIntent(
    text,
    hasMedia,
    mediaType,
    tenantConfig?.routerKeywords,
    tenantConfig?.soulPrompt
  );
  const target = resolveTarget(intent, hasMedia, tenantConfig);

  return {
    user_intent: intent,
    route_target: target,
    requires_human: target === RouteTarget.HUMAN_HANDOFF,
    trace: [`router:${intent}->${target}`]
  };
};

export const routerCondition = (state: AgentState): string => state.route_target;
