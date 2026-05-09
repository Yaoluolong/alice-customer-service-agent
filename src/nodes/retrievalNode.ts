import { RunnableConfig } from "@langchain/core/runnables";
import { resolveOvClient } from "../clients/resolve-ov-client";
import { SearchItem } from "../clients/openviking-client";
import {
  AgentState,
  EnrichedSearchItem,
  RetrievedContext,
  RouteTarget,
} from "../types";
import { getRelevance } from "../utils/relevance";
import { logger } from "../logger";

// --- Helper: build enhanced query from user text + memory context ---

interface MemoryContextSlice {
  preferences?: Array<{ abstract: string }>;
  entities?: Array<{ abstract: string }>;
}

/**
 * Heuristic query rewriting: append novel preference/entity terms from memory context.
 */
export function buildEnhancedQuery(
  userText: string,
  memoryContext: MemoryContextSlice | null | undefined
): string {
  if (!memoryContext) return userText;

  const novelTerms: string[] = [];
  const lowerUser = userText.toLowerCase();

  const extractTerms = (items: Array<{ abstract: string }> | undefined) => {
    if (!items) return;
    for (const item of items) {
      const words = item.abstract
        .split(/[\s,;，；]+/)
        .map((w) => w.trim())
        .filter((w) => w.length > 1);
      for (const word of words) {
        if (!lowerUser.includes(word.toLowerCase()) && !novelTerms.includes(word)) {
          novelTerms.push(word);
        }
      }
    }
  };

  extractTerms(memoryContext.preferences);
  extractTerms(memoryContext.entities);

  if (novelTerms.length === 0) return userText;
  return `${userText} ${novelTerms.join(" ")}`;
}

// --- Helper: enrich search items ---

function enrichItems(items: SearchItem[]): EnrichedSearchItem[] {
  return items.map((item) => ({
    uri: item.uri,
    abstract: item.abstract,
    score: item.score,
    context_type: item.context_type,
    is_leaf: item.is_leaf,
    match_reason: item.match_reason,
    relevance: getRelevance(item.score),
    detailLoaded: false,
  }));
}

// --- Helper: merge two search result arrays by URI (keep higher score) ---

function mergeByUri(a: EnrichedSearchItem[], b: EnrichedSearchItem[]): EnrichedSearchItem[] {
  const map = new Map<string, EnrichedSearchItem>();
  for (const item of a) {
    map.set(item.uri, item);
  }
  for (const item of b) {
    const existing = map.get(item.uri);
    if (!existing || item.score > existing.score) {
      map.set(item.uri, item);
    }
  }
  return Array.from(map.values()).sort((x, y) => y.score - x.score);
}

// --- Main node ---

const SKIP_ROUTES: RouteTarget[] = [
  RouteTarget.ORDER_AGENT,
  RouteTarget.HUMAN_HANDOFF,
  RouteTarget.CONVERSATION_CLOSING,
];

export async function retrievalNode(
  state: AgentState,
  config?: RunnableConfig
): Promise<Partial<AgentState>> {
  const startTime = Date.now();

  // (a) Skip routes
  if (SKIP_ROUTES.includes(state.route_target)) {
    return {
      retrieved_context: null,
      trace: [
        ...state.trace,
        {
          node: "retrievalNode",
          displayName: "Retrieval",
          output: `Skipped — route_target=${state.route_target}`,
        },
      ],
    };
  }

  const ov = resolveOvClient(config);
  const tenantId = state.tenant_id;
  const customerId = state.customer_id;

  // Resolve session ID (local_ prefix → undefined)
  const rawSessionId = state.openviking_session_id;
  const sessionId =
    rawSessionId && !rawSessionId.startsWith("local_") ? rawSessionId : undefined;

  // Resolve target URIs from tenant config
  const productUri =
    state.tenant_config?.knowledgeSchema?.searchScopes?.product_inquiry ??
    "viking://resources/products/";
  const knowledgeUri =
    state.tenant_config?.knowledgeSchema?.searchScopes?.knowledge_query ??
    "viking://resources/knowledge/";

  // (b) Build search query
  const lastUserMsg =
    state.messages.length > 0
      ? typeof state.messages[state.messages.length - 1].content === "string"
        ? (state.messages[state.messages.length - 1].content as string)
        : ""
      : "";

  const memCtx = state.memory_context?.longTerm ?? null;
  const enhancedQuery = buildEnhancedQuery(lastUserMsg, memCtx);

  // For VISUAL_AGENT: prepend media_description
  const baseQuery =
    state.route_target === RouteTarget.VISUAL_AGENT
      ? `${state.media_description ?? ""} ${lastUserMsg}`.trim()
      : lastUserMsg;
  const visualEnhanced =
    state.route_target === RouteTarget.VISUAL_AGENT
      ? buildEnhancedQuery(baseQuery, memCtx)
      : enhancedQuery;

  const queryUsed =
    state.route_target === RouteTarget.VISUAL_AGENT ? visualEnhanced : enhancedQuery;

  try {
    let products: EnrichedSearchItem[] = [];
    let knowledge: EnrichedSearchItem[] = [];

    // (c) Search by route_target
    switch (state.route_target) {
      case RouteTarget.SALES_AGENT:
      case RouteTarget.VISUAL_AGENT: {
        const searchQuery =
          state.route_target === RouteTarget.VISUAL_AGENT ? baseQuery : lastUserMsg;
        const enhanced =
          state.route_target === RouteTarget.VISUAL_AGENT ? visualEnhanced : enhancedQuery;

        // (d) Dual-path search
        if (enhanced !== searchQuery) {
          const [res1, res2] = await Promise.all([
            ov.search(tenantId, customerId, searchQuery, sessionId, productUri, 5),
            ov.search(tenantId, customerId, enhanced, sessionId, productUri, 5),
          ]);
          const items1 = enrichItems([...res1.resources, ...res1.memories]);
          const items2 = enrichItems([...res2.resources, ...res2.memories]);
          products = mergeByUri(items1, items2);
        } else {
          const res = await ov.search(tenantId, customerId, searchQuery, sessionId, productUri, 5);
          products = enrichItems([...res.resources, ...res.memories]);
        }
        break;
      }

      case RouteTarget.KNOWLEDGE_AGENT: {
        const res = await ov.search(
          tenantId,
          customerId,
          enhancedQuery,
          sessionId,
          knowledgeUri,
          5
        );
        knowledge = enrichItems([...res.resources, ...res.memories]);
        break;
      }

      case RouteTarget.CHAT_AGENT: {
        const [prodRes, knowRes] = await Promise.all([
          ov.search(tenantId, customerId, enhancedQuery, sessionId, productUri, 3),
          ov.search(tenantId, customerId, enhancedQuery, sessionId, knowledgeUri, 3),
        ]);
        products = enrichItems([...prodRes.resources, ...prodRes.memories]);
        knowledge = enrichItems([...knowRes.resources, ...knowRes.memories]);
        break;
      }
    }

    // (e) Smart readDetail based on top-1 score
    const allItems = [...products, ...knowledge].sort((a, b) => b.score - a.score);
    const topDetails: string[] = [];

    if (allItems.length > 0) {
      const topScore = allItems[0].score;
      let detailCount = 0;
      if (topScore > 0.7) {
        detailCount = 1;
      } else if (topScore >= 0.4) {
        detailCount = Math.min(2, allItems.length);
      }

      const detailPromises = allItems.slice(0, detailCount).map(async (item) => {
        const detail = await ov.readDetail(tenantId, customerId, item.uri);
        item.detailLoaded = true;
        return detail;
      });

      const details = await Promise.all(detailPromises);
      topDetails.push(...details.filter((d) => d));
    }

    const elapsed = Date.now() - startTime;
    logger.info(
      { tenantId, customerId, route: state.route_target, queryUsed, elapsed },
      "retrievalNode completed"
    );

    return {
      retrieved_context: { products, knowledge, topDetails, queryUsed },
      trace: [
        ...state.trace,
        {
          node: "retrievalNode",
          displayName: "Retrieval",
          output: `Found ${products.length} products, ${knowledge.length} knowledge items, ${topDetails.length} details loaded`,
          metadata: { queryUsed, elapsed },
        },
      ],
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err, tenantId, customerId }, "retrievalNode OV search failed");

    return {
      retrieved_context: { products: [], knowledge: [], topDetails: [], queryUsed },
      trace: [
        ...state.trace,
        {
          node: "retrievalNode",
          displayName: "Retrieval",
          output: `Error: ${errorMsg}`,
          metadata: { error: true },
        },
      ],
    };
  }
}
