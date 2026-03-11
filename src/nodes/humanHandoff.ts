import { AIMessage } from "@langchain/core/messages";
import { AgentState, RouteTarget } from "../types";

const buildHandoffReply = (language: string, reason: string): string => {
  if (language === "en-US") {
    return `To make sure you get an accurate answer, I'll connect you with a specialist now. Context shared: ${reason}. While we connect, you can add your order ID or product details to speed things up.`;
  }
  return `为了给你更稳妥的答复，我先帮你接入人工同事。已同步关键信息：${reason}。你也可以补充订单号或商品细节，我这边会一起转交。`;
};

export const humanHandoffNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  const reason =
    state.handoff_reason ?? state.confidence_reasons[0] ?? "当前信息存在不确定项，需要人工进一步核验";

  return {
    requires_human: true,
    route_target: RouteTarget.HUMAN_HANDOFF,
    handoff_reason: reason,
    trace: ["human:required"],
    messages: [new AIMessage(buildHandoffReply(state.reply_language, reason))]
  };
};
