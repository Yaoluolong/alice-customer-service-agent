import { HumanMessage } from "@langchain/core/messages";
import { AgentState, GroundingFacts, TraceEntry, UserIntent } from "../types";
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

  // Read supplementary context from retrieved_context (if available)
  const products = state.retrieved_context?.products ?? [];
  const knowledge = state.retrieved_context?.knowledge ?? [];
  const topScore = Math.max(
    products[0]?.score ?? 0,
    knowledge[0]?.score ?? 0
  );

  // Dynamic confidence: chat agent has lower cap and smaller boost
  const dynamicConfidence = topScore > 0
    ? Math.min(topScore + 0.05, 0.8)
    : 0.5;

  // Build additional grounding facts from retrieved context
  const additionalFacts: Array<{ key: string; value: string; source: "retrieval"; confidence: number; sourceUri?: string }> = [];

  if (products.length > 0) {
    additionalFacts.push({
      key: "related_product",
      value: products[0].abstract?.slice(0, 200) ?? products[0].uri,
      source: "retrieval",
      confidence: products[0].score,
      sourceUri: products[0].uri
    });
  }

  if (knowledge.length > 0) {
    additionalFacts.push({
      key: "related_knowledge",
      value: knowledge[0].abstract?.slice(0, 200) ?? knowledge[0].uri,
      source: "retrieval",
      confidence: knowledge[0].score,
      sourceUri: knowledge[0].uri
    });
  }

  const facts: GroundingFacts = {
    intent: UserIntent.GENERAL_CHAT,
    fact_confidence: dynamicConfidence,
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
      },
      ...additionalFacts
    ],
    unknowns: [],
    next_actions: ["可继续闲聊", "可引导到商品推荐、库存查询或订单查询"]
  };

  const chatTrace: TraceEntry = {
    node: "chat",
    displayName: "Chat Agent",
    input: userText.slice(0, 80),
    output: state.user_preferences.length > 0
      ? `Context prepared (${state.user_preferences.length} known preferences)`
      : "Context prepared (general conversation)",
    metadata: {
      preferencesKnown: state.user_preferences.length > 0,
      preferenceCount: state.user_preferences.length,
      factConfidence: facts.fact_confidence,
      severity: "ok",
    },
  };

  return {
    style_profile: updateStyleProfileFromUserText(state.style_profile, userText),
    grounding_facts: facts,
    trace: [chatTrace]
  };
};
