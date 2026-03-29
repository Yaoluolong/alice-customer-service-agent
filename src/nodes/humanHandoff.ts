import { AIMessage } from "@langchain/core/messages";
import { AgentState, RouteTarget } from "../types";

// Customer-facing message must never contain internal reviewer reasons or technical details.
const buildHandoffReply = (language: string): string => {
  if (language === "en-US") {
    return "Leave it with me — I'll get one of my colleagues to help you with this. They'll have the full context. Feel free to add any extra details (order ID, product name) and I'll pass it all along. 😊";
  }
  return "为了给你更准确的答复，我帮你转接一下人工同事，他们会继续跟进。你也可以补充一下订单号或商品细节，我会一起同步过去。";
};

export const humanHandoffNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  const reason =
    state.handoff_reason ?? state.confidence_reasons[0] ?? "当前信息存在不确定项，需要人工进一步核验";

  return {
    requires_human: true,
    route_target: RouteTarget.HUMAN_HANDOFF,
    handoff_reason: reason,
    trace: ["human:required"],
    messages: [new AIMessage(buildHandoffReply(state.reply_language))]
  };
};
