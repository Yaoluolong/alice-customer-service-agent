import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getConfiguredModel } from "../config/models";
import { buildRouterSystemPrompt } from "../config/persona";
import { AgentState, RouteTarget, UserIntent } from "../types";
import { getLastUserText } from "../utils/messages";

const heuristicClassify = (text: string, hasImage: boolean): UserIntent => {
  if (hasImage) return UserIntent.VISUAL_SEARCH;
  if (/订单|物流|发货|退款|催单|快递|order|tracking|shipment/.test(text)) return UserIntent.ORDER_STATUS;
  if (/商品|风衣|颜色|尺码|库存|推荐|有吗|多少钱|product|size|stock|price/.test(text)) {
    return UserIntent.PRODUCT_INQUIRY;
  }
  if (/你好|谢谢|再见|聊聊|hello|thanks|hi/.test(text)) return UserIntent.GENERAL_CHAT;
  return UserIntent.UNKNOWN;
};

const classifyIntent = async (text: string, hasImage: boolean): Promise<UserIntent> => {
  const llm = getConfiguredModel("aux", 0);
  if (!llm) return heuristicClassify(text, hasImage);

  try {
    const response = await llm.invoke([
      new SystemMessage(await buildRouterSystemPrompt()),
      new HumanMessage(`has_image=${hasImage}; text=${text}`)
    ]);
    const normalized = String(response.content).trim().toLowerCase();
    if (normalized.includes("visual_search")) return UserIntent.VISUAL_SEARCH;
    if (normalized.includes("product_inquiry")) return UserIntent.PRODUCT_INQUIRY;
    if (normalized.includes("order_status")) return UserIntent.ORDER_STATUS;
    if (normalized.includes("general_chat")) return UserIntent.GENERAL_CHAT;
    return UserIntent.UNKNOWN;
  } catch {
    return heuristicClassify(text, hasImage);
  }
};

const resolveTarget = (intent: UserIntent, hasImage: boolean): RouteTarget => {
  if (hasImage || intent === UserIntent.VISUAL_SEARCH) return RouteTarget.VISUAL_AGENT;
  if (intent === UserIntent.ORDER_STATUS) return RouteTarget.ORDER_AGENT;
  if (intent === UserIntent.GENERAL_CHAT) return RouteTarget.CHAT_AGENT;
  if (intent === UserIntent.PRODUCT_INQUIRY) return RouteTarget.SALES_AGENT;
  return RouteTarget.HUMAN_HANDOFF;
};

export const routerNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  const text = getLastUserText(state.messages);
  const hasImage = Boolean(state.image_context);
  const intent = await classifyIntent(text, hasImage);
  const target = resolveTarget(intent, hasImage);

  return {
    user_intent: intent,
    route_target: target,
    requires_human: target === RouteTarget.HUMAN_HANDOFF,
    trace: [`router:${intent}->${target}`]
  };
};

export const routerCondition = (state: AgentState): string => state.route_target;
