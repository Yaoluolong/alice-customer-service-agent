import { HumanMessage } from "@langchain/core/messages";
import { vikingClient } from "../mocks/openviking";
import { AgentState, GroundingFacts, UserIntent } from "../types";

const getLastUserText = (state: AgentState): string => {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    if (state.messages[i] instanceof HumanMessage) {
      return String(state.messages[i].content ?? "");
    }
  }
  return "";
};

export const visualAgentNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  const query = getLastUserText(state);

  const result = await vikingClient.recursiveSearch("viking://resources/products/", query);
  const top = result.products[0] ?? null;

  const grounding: GroundingFacts = top
    ? {
        intent: UserIntent.VISUAL_SEARCH,
        fact_confidence: 0.78,
        facts: [
          {
            key: "top_candidate",
            value: `${top.name}（相似度 ${(top.similarityScore ?? 0).toFixed(2)}）`,
            source: "retrieval",
            confidence: 0.78
          }
        ],
        unknowns: [],
        next_actions: ["继续查询库存并匹配颜色尺码"]
      }
    : {
        intent: UserIntent.VISUAL_SEARCH,
        fact_confidence: 0.45,
        facts: [],
        unknowns: ["未检索到高匹配商品"],
        next_actions: ["请补充商品关键词或更清晰图片"]
      };

  return {
    retrieved_products: result.products,
    current_product_id: top?.id ?? null,
    user_intent: UserIntent.PRODUCT_INQUIRY,
    grounding_facts: grounding,
    trace: [`visual:found=${result.products.length}`]
  };
};
