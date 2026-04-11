import { HumanMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { getConfiguredModel } from "../config/models";
import { resolveOvClient } from "../clients/resolve-ov-client";
import { AgentState, GroundingFacts, MediaContext, ProductInfo, UserIntent } from "../types";

const getLastUserText = (state: AgentState): string => {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    if (state.messages[i] instanceof HumanMessage) {
      return String(state.messages[i].content ?? "");
    }
  }
  return "";
};

const describeMediaWithVLM = async (media: MediaContext, userText: string): Promise<string> => {
  const llm = getConfiguredModel("primary", 0);
  if (!llm) return userText;

  try {
    // Build vision message
    const content: Array<{ type: string; [key: string]: unknown }> = [
      {
        type: "text",
        text: `Describe this ${media.mediaType} in detail, focusing on product features, colors, style, and material. User query: "${userText}". Respond in the same language as the user query.`
      }
    ];

    if (media.base64Data) {
      content.unshift({
        type: "image_url",
        image_url: {
          url: `data:${media.mimeType};base64,${media.base64Data}`,
          detail: "high"
        }
      });
    } else if (media.url) {
      content.unshift({
        type: "image_url",
        image_url: { url: media.url, detail: "high" }
      });
    }

    const response = await llm.invoke([new HumanMessage({ content })]);
    return String(response.content).trim();
  } catch {
    return userText;
  }
};

const searchItemsToProducts = (
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

export const visualAgentNode = async (state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> => {
  const openVikingClient = resolveOvClient(config);
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

  let description = media?.description ?? query;
  let updatedMedia = media;

  // If media has no description yet, call VLM
  if (media && !media.description) {
    description = await describeMediaWithVLM(media, query);
    updatedMedia = { ...media, description };
  }

  // Search tenant knowledge base with combined query
  const searchQuery = description !== query ? `${description} ${query}` : query;
  let products: ProductInfo[] = [];

  try {
    const result = await openVikingClient.search(
      state.tenant_id,
      state.customer_id,
      searchQuery,
      state.openviking_session_id?.startsWith("local_") ? undefined : state.openviking_session_id ?? undefined,
      "viking://resources/products/",
      5
    );
    const items = [...(result.resources ?? []), ...(result.memories ?? [])].sort(
      (a, b) => b.score - a.score
    );
    products = searchItemsToProducts(items);
  } catch {
    // Non-fatal: return empty results
  }

  const top = products[0] ?? null;

  // Enrich top-1 result with L2 detail
  let topDetail = top ? `${top.name}（相似度 ${(top.similarityScore ?? 0).toFixed(2)}）` : "";
  if (top?.imageUrl?.startsWith("viking://")) {
    try {
      const detail = await openVikingClient.readDetail(state.tenant_id, state.customer_id, top.imageUrl);
      if (detail) topDetail = detail.slice(0, 2000);
    } catch {
      // Fallback to name
    }
  }

  const grounding: GroundingFacts = top
    ? {
        intent: UserIntent.VISUAL_SEARCH,
        fact_confidence: 0.78,
        facts: [
          {
            key: "top_candidate",
            value: topDetail,
            source: "retrieval",
            confidence: 0.78,
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
        fact_confidence: 0.45,
        facts: [],
        unknowns: ["未检索到高匹配商品"],
        next_actions: ["请补充商品关键词或更清晰图片"]
      };

  return {
    media_context: updatedMedia,
    retrieved_products: products,
    current_product_id: top?.id ?? null,
    user_intent: UserIntent.PRODUCT_INQUIRY,
    grounding_facts: grounding,
    trace: [`visual:found=${products.length},desc=${description.length > 0 ? "yes" : "no"}`]
  };
};
