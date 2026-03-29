import { HumanMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { resolveOvClient } from "../clients/resolve-ov-client";
import { AgentState, GroundingFacts, UserIntent } from "../types";

const getLastUserText = (state: AgentState): string => {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    if (state.messages[i] instanceof HumanMessage) {
      return String(state.messages[i].content ?? "");
    }
  }
  return "";
};

export const knowledgeAgentNode = async (
  state: AgentState,
  config?: RunnableConfig
): Promise<Partial<AgentState>> => {
  const openVikingClient = resolveOvClient(config);
  const { tenant_id, customer_id, openviking_session_id, tenant_config } = state;
  const userText = getLastUserText(state);

  const targetUri =
    tenant_config?.knowledgeSchema?.searchScopes?.knowledge_query ??
    "viking://resources/knowledge/";

  let items: import("../clients/openviking-client").SearchItem[] = [];
  try {
    const result = await openVikingClient.search(
      tenant_id,
      customer_id,
      userText,
      openviking_session_id?.startsWith("local_") ? undefined : (openviking_session_id ?? undefined),
      targetUri,
      5
    );
    items = [...(result.resources ?? [])].sort((a, b) => b.score - a.score);
  } catch {
    // Non-fatal: return low-confidence fallback
  }

  if (items.length === 0) {
    const noResultFacts: GroundingFacts = {
      intent: UserIntent.KNOWLEDGE_QUERY,
      facts: [{ key: "no_knowledge", value: "未找到相关知识", source: "retrieval", confidence: 0.3 }],
      fact_confidence: 0.35,
      unknowns: ["no matching knowledge found in knowledge base"],
      next_actions: ["suggest rephrasing or contacting human support"]
    };
    return { grounding_facts: noResultFacts, trace: ["knowledge_agent:no_results"] };
  }

  // Enrich top-1 result with L2 detail if available
  let topValue = items[0].abstract ?? items[0].uri;
  try {
    const detail = await openVikingClient.readDetail(tenant_id, customer_id, items[0].uri);
    if (detail) topValue = detail.slice(0, 2000);
  } catch {
    // Fallback to abstract
  }

  const facts: GroundingFacts = {
    intent: UserIntent.KNOWLEDGE_QUERY,
    facts: [
      {
        key: "knowledge_0",
        value: topValue,
        source: "retrieval",
        confidence: items[0].score,
        sourceUri: items[0].uri
      },
      ...items.slice(1, 3).map((item, i) => ({
        key: `knowledge_${i + 1}`,
        value: item.abstract ?? item.uri,
        source: "retrieval" as const,
        confidence: item.score,
        sourceUri: item.uri
      }))
    ],
    fact_confidence: Math.max(items[0].score, 0.6),
    unknowns: [],
    next_actions: ["answer based on knowledge base content"]
  };

  return {
    grounding_facts: facts,
    trace: [`knowledge_agent:found=${items.length}`]
  };
};
