import { HumanMessage } from "@langchain/core/messages";
import { AgentState, GroundingFacts, UserIntent } from "../types";
import { updateStyleProfileFromUserText } from "../utils/style";

interface MockOrderRecord {
  orderId: string;
  userId: string;
  status: "processing" | "shipped" | "delivered";
  carrier: string;
  trackingNo: string;
}

const MOCK_ORDERS: MockOrderRecord[] = [
  {
    orderId: "ORD-20260308-1001",
    userId: "user_10001",
    status: "shipped",
    carrier: "SF Express",
    trackingNo: "SF123456789CN"
  }
];

const getLastUserText = (state: AgentState): string => {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    if (state.messages[i] instanceof HumanMessage) {
      return String(state.messages[i].content ?? "");
    }
  }
  return "";
};

const extractOrderId = (text: string): string | null => {
  const match = text.match(/ORD-\d{8}-\d{4}/i);
  return match ? match[0].toUpperCase() : null;
};

export const orderAgentNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  const text = getLastUserText(state);
  const orderId = extractOrderId(text);
  const nextStyle = updateStyleProfileFromUserText(state.style_profile, text);

  const record = orderId
    ? MOCK_ORDERS.find((order) => order.orderId === orderId && order.userId === state.user_id)
    : MOCK_ORDERS.find((order) => order.userId === state.user_id);

  if (!record) {
    const missingFacts: GroundingFacts = {
      intent: UserIntent.ORDER_STATUS,
      facts: [],
      unknowns: ["未匹配到订单记录"],
      next_actions: ["请补充订单号或下单手机号后四位", "我可以先帮你核对最近一周订单"],
      fact_confidence: 0.32
    };

    return {
      style_profile: nextStyle,
      grounding_facts: missingFacts,
      trace: ["order:not-found"]
    };
  }

  const statusMap: Record<MockOrderRecord["status"], string> = {
    processing: "处理中",
    shipped: "已发货",
    delivered: "已签收"
  };

  const facts: GroundingFacts = {
    intent: UserIntent.ORDER_STATUS,
    fact_confidence: 0.94,
    facts: [
      { key: "order_id", value: record.orderId, source: "order", confidence: 0.95 },
      { key: "status", value: statusMap[record.status], source: "order", confidence: 0.94 },
      { key: "carrier", value: record.carrier, source: "order", confidence: 0.93 },
      { key: "tracking_no", value: record.trackingNo, source: "order", confidence: 0.93 }
    ],
    unknowns: [],
    next_actions: ["如果你愿意，我可以继续帮你预估签收时间", "也可以帮你生成催派送话术"]
  };

  return {
    style_profile: nextStyle,
    grounding_facts: facts,
    trace: [`order:${record.orderId}`]
  };
};
