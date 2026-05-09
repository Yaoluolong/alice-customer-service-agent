import { HumanMessage } from "@langchain/core/messages";
import { AgentState, EnrichedSearchItem, GroundingFacts, TraceEntry, UserIntent } from "../types";

const getLastUserText = (state: AgentState): string => {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    if (state.messages[i] instanceof HumanMessage) {
      return String(state.messages[i].content ?? "");
    }
  }
  return "";
};

export const knowledgeAgentNode = async (
  state: AgentState
): Promise<Partial<AgentState>> => {
  const userText = getLastUserText(state);

  // Read knowledge from state.retrieved_context (populated by retrievalNode)
  const items: EnrichedSearchItem[] = state.retrieved_context?.knowledge ?? [];

  if (items.length === 0) {
    // Dynamic confidence: no results
    const dynamicConfidence = 0.2;

    const noResultFacts: GroundingFacts = {
      intent: UserIntent.KNOWLEDGE_QUERY,
      facts: [{ key: "no_knowledge", value: "未找到相关知识", source: "retrieval", confidence: 0.3 }],
      fact_confidence: dynamicConfidence,
      unknowns: ["no matching knowledge found in knowledge base"],
      next_actions: ["suggest rephrasing or contacting human support"]
    };
    const noResultTrace: TraceEntry = {
      node: "knowledge_agent",
      displayName: "Knowledge Agent",
      input: userText.slice(0, 80),
      output: "No results",
      metadata: { resultCount: 0, severity: "warn", suggestions: ["Knowledge base may lack relevant content"] },
    };
    return { grounding_facts: noResultFacts, trace: [noResultTrace] };
  }

  const topScore = items[0].score;

  // Enrich top-1 with L2 detail from retrieved_context
  let topValue = state.retrieved_context?.topDetails?.[0] ?? items[0].abstract ?? items[0].uri;

  // Dynamic confidence
  const dynamicConfidence = Math.min(topScore + 0.1, 0.95);

  const facts: GroundingFacts = {
    intent: UserIntent.KNOWLEDGE_QUERY,
    facts: [
      {
        key: "knowledge_0",
        value: topValue,
        source: "retrieval",
        confidence: topScore,
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
    fact_confidence: dynamicConfidence,
    unknowns: [],
    next_actions: ["answer based on knowledge base content"]
  };

  const foundTrace: TraceEntry = {
    node: "knowledge_agent",
    displayName: "Knowledge Agent",
    input: userText.slice(0, 80),
    output: `Found ${items.length} articles (top score: ${topScore.toFixed(2)})`,
    metadata: { resultCount: items.length, topScore, severity: "ok", suggestions: [] },
  };

  return {
    grounding_facts: facts,
    trace: [foundTrace]
  };
};
