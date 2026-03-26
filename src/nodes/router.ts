import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getConfiguredModel } from "../config/models";
import { buildRouterSystemPrompt } from "../config/persona";
import { AgentState, RouteTarget, UserIntent } from "../types";
import { getLastUserText } from "../utils/messages";

const DEFAULT_KEYWORDS: Record<string, string[]> = {
  order_status: ["订单", "物流", "发货", "退款", "催单", "快递", "order", "tracking", "shipment"],
  product_inquiry: ["商品", "风衣", "颜色", "尺码", "库存", "推荐", "有吗", "多少钱", "product", "size", "stock", "price"],
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
    if (normalized.includes("product_inquiry")) return UserIntent.PRODUCT_INQUIRY;
    if (normalized.includes("order_status")) return UserIntent.ORDER_STATUS;
    if (normalized.includes("general_chat")) return UserIntent.GENERAL_CHAT;
    return UserIntent.UNKNOWN;
  } catch {
    return heuristicClassify(text, hasMedia, keywordOverrides);
  }
};

const resolveTarget = (intent: UserIntent, hasMedia: boolean): RouteTarget => {
  if (hasMedia || intent === UserIntent.VISUAL_SEARCH || intent === UserIntent.VIDEO_SEARCH) {
    return RouteTarget.VISUAL_AGENT;
  }
  if (intent === UserIntent.ORDER_STATUS) return RouteTarget.ORDER_AGENT;
  if (intent === UserIntent.GENERAL_CHAT) return RouteTarget.CHAT_AGENT;
  if (intent === UserIntent.PRODUCT_INQUIRY) return RouteTarget.SALES_AGENT;
  return RouteTarget.HUMAN_HANDOFF;
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
  const target = resolveTarget(intent, hasMedia);

  return {
    user_intent: intent,
    route_target: target,
    requires_human: target === RouteTarget.HUMAN_HANDOFF,
    trace: [`router:${intent}->${target}`]
  };
};

export const routerCondition = (state: AgentState): string => state.route_target;
