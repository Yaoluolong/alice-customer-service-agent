import { HumanMessage } from "@langchain/core/messages";
import { AgentState, GroundingFacts, MediaContext, ProductInfo, TraceEntry, UserIntent } from "../types";

const getLastUserText = (state: AgentState): string => {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    if (state.messages[i] instanceof HumanMessage) {
      return String(state.messages[i].content ?? "");
    }
  }
  return "";
};

export const searchItemsToProducts = (
  items: Array<{ uri: string; abstract: string; score: number }>
): ProductInfo[] =>
  items.map((item, idx) => ({
    id: item.uri.split("/").filter(Boolean).pop() ?? `prod_${idx}`,
    name: item.abstract.split("\n")[0]?.slice(0, 80) ?? item.uri,
    category: item.uri.replace("viking://resources/products/", ""),
    colors: [],
    sizes: [],
    price: 0,
    description: item.abstract,
    imageUrl: item.uri,
    similarityScore: item.score
  }));

export const visualAgentNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  const query = getLastUserText(state);
  const media = state.media_context ?? (
    state.image_context
      ? {
          mediaId: state.image_context.imageId,
          mediaType: "image" as const,
          base64Data: state.image_context.base64Data,
          mimeType: state.image_context.mimeType,
          description: state.image_context.description
        }
      : null
  );

  // Use media_description from state (populated by mediaDescribeNode)
  const description = state.media_description ?? media?.description ?? query;
  let updatedMedia: MediaContext | null = media;
  if (media && !media.description && state.media_description) {
    updatedMedia = { ...media, description: state.media_description };
  }

  // Read products from state.retrieved_context (populated by retrievalNode)
  const retrievedItems = state.retrieved_context?.products ?? [];
  const products = searchItemsToProducts(retrievedItems);

  const top = products[0] ?? null;
  const topScore = retrievedItems[0]?.score ?? null;

  // Enrich top-1 with L2 detail from retrieved_context
  const topDetail = state.retrieved_context?.topDetails?.[0]
    ?? (top ? `${top.name}（相似度 ${(top.similarityScore ?? 0).toFixed(2)}）` : "");

  // Dynamic confidence
  const dynamicConfidence = products.length > 0
    ? Math.min((topScore ?? 0) + 0.1, 0.95)
    : 0.2;

  const grounding: GroundingFacts = top
    ? {
        intent: UserIntent.VISUAL_SEARCH,
        fact_confidence: dynamicConfidence,
        facts: [
          {
            key: "top_candidate",
            value: topDetail,
            source: "retrieval",
            confidence: dynamicConfidence,
            sourceUri: top.imageUrl
          },
          ...(description !== query
            ? [{ key: "media_description", value: description.slice(0, 200), source: "retrieval" as const, confidence: 0.9 }]
            : [])
        ],
        unknowns: [],
        next_actions: ["继续查询库存并匹配颜色尺码"]
      }
    : {
        intent: UserIntent.VISUAL_SEARCH,
        fact_confidence: dynamicConfidence,
        facts: [],
        unknowns: ["未检索到高匹配商品"],
        next_actions: ["请补充商品关键词或更清晰图片"]
      };

  const visualTrace: TraceEntry = {
    node: "visual",
    displayName: "Visual Search",
    input: `Image uploaded${query ? ` + "${query.slice(0, 50)}"` : ""}`,
    output: products.length > 0
      ? `Found ${products.length} similar products`
      : "No similar products found",
    metadata: {
      descriptionLength: description.length,
      resultCount: products.length,
      topScore: top?.similarityScore,
      severity: products.length > 0 ? "ok" : "warn",
    },
  };

  return {
    media_context: updatedMedia,
    retrieved_products: products,
    current_product_id: top?.id ?? null,
    user_intent: UserIntent.PRODUCT_INQUIRY,
    grounding_facts: grounding,
    trace: [visualTrace]
  };
};
