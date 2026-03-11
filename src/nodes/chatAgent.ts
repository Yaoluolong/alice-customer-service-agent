import { HumanMessage } from "@langchain/core/messages";
import { AgentState, GroundingFacts, UserIntent } from "../types";
import { updateStyleProfileFromUserText } from "../utils/style";

const getLastUserText = (state: AgentState): string => {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    if (state.messages[i] instanceof HumanMessage) {
      return String(state.messages[i].content ?? "");
    }
  }
  return "";
};

export const chatAgentNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  const userText = getLastUserText(state);
  const prefText = state.user_preferences.length
    ? state.user_preferences.map((item) => `${item.key}:${JSON.stringify(item.value)}`).join("; ")
    : "暂无";

  const facts: GroundingFacts = {
    intent: UserIntent.GENERAL_CHAT,
    fact_confidence: 0.75,
    facts: [
      {
        key: "chat_context",
        value: "用户在进行一般交流或需求澄清",
        source: "chat",
        confidence: 0.8
      },
      {
        key: "known_preferences",
        value: prefText,
        source: "memory",
        confidence: state.user_preferences.length > 0 ? 0.78 : 0.4
      }
    ],
    unknowns: [],
    next_actions: ["可继续闲聊", "可引导到商品推荐、库存查询或订单查询"]
  };

  return {
    style_profile: updateStyleProfileFromUserText(state.style_profile, userText),
    grounding_facts: facts,
    trace: ["chat:facts-ready"]
  };
};
