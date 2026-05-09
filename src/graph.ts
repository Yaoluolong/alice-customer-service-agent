import { BaseMessage } from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { chatAgentNode } from "./nodes/chatAgent";
import { clarificationPreCheckNode, preCheckCondition, clarificationGateNode, gateCondition } from "./nodes/clarificationGate";
import { confidenceGateCondition, confidenceGateNode } from "./nodes/confidenceGate";
import { humanHandoffNode } from "./nodes/humanHandoff";
import { knowledgeAgentNode } from "./nodes/knowledgeAgent";
import { mediaDescribeNode } from "./nodes/mediaDescribeNode";
import { memoryBootstrapNode, memoryPersistNode } from "./nodes/memoryNode";
import { orderAgentNode } from "./nodes/orderAgent";
import { responseComposerNode } from "./nodes/responseComposer";
import { responseReviewerNode } from "./nodes/responseReviewer";
import { retrievalNode } from "./nodes/retrievalNode";
import { routerCondition, routerNode } from "./nodes/router";
import { salesAgentNode } from "./nodes/salesAgent";
import { visualAgentNode } from "./nodes/visualAgent";
import { AgentState, GroundingFacts, RetrievedContext, RouteTarget, TenantAgentConfig, TraceEntry, UserIntent } from "./types";

export const AgentStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (left, right) => left.concat(right),
    default: () => []
  }),
  user_id: Annotation<string>,
  session_id: Annotation<string>,
  tenant_id: Annotation<string>,
  customer_id: Annotation<string>,
  tenant_config: Annotation<TenantAgentConfig | null>,
  user_intent: Annotation<UserIntent>,
  route_target: Annotation<RouteTarget>,
  current_product_id: Annotation<string | null>,
  image_context: Annotation<AgentState["image_context"]>,
  media_context: Annotation<AgentState["media_context"]>,
  memory_context: Annotation<AgentState["memory_context"]>,
  openviking_session_id: Annotation<string | null>,
  openviking_message_count: Annotation<number>,
  retrieved_products: Annotation<AgentState["retrieved_products"]>,
  user_preferences: Annotation<AgentState["user_preferences"]>,
  requires_human: Annotation<boolean>,
  human_feedback: Annotation<string | undefined>,

  grounding_facts: Annotation<GroundingFacts | null>({
    reducer: (existing, update) => {
      if (!update) return existing;
      if (!existing) return update;
      return {
        intent: update.intent,
        facts: [...existing.facts, ...update.facts],
        unknowns: [...existing.unknowns, ...update.unknowns],
        fact_confidence: Math.max(existing.fact_confidence, update.fact_confidence),
        next_actions: [...existing.next_actions, ...update.next_actions],
      };
    },
    default: () => null,
  }),
  draft_reply: Annotation<string | null>,
  tone_applied: Annotation<AgentState["tone_applied"]>,
  variation_id: Annotation<string | null>,
  agent_confidence: Annotation<number>,
  review_flags: Annotation<string[]>,
  confidence_reasons: Annotation<string[]>,
  handoff_reason: Annotation<string | null>,
  reply_language: Annotation<string>,
  conversation_summary: Annotation<string | null>,
  style_profile: Annotation<AgentState["style_profile"]>,
  recent_opening_templates: Annotation<string[]>,

  retrieved_context: Annotation<RetrievedContext | null>({ reducer: (_, v) => v, default: () => null }),
  media_description: Annotation<string | null>({ reducer: (_, v) => v, default: () => null }),
  intent_confidence: Annotation<number>({ reducer: (_, v) => v, default: () => 1.0 }),
  intent_candidates: Annotation<string[]>({ reducer: (_, v) => v, default: () => [] }),
  requires_clarification: Annotation<boolean>({ reducer: (_, v) => v, default: () => false }),
  conversation_closing: Annotation<boolean>({ reducer: (_, v) => v, default: () => false }),

  trace: Annotation<TraceEntry[]>({
    reducer: (left, right) => left.concat(right),
    default: () => []
  })
});

export const buildCustomerServiceGraph = () => {
  const graph = new StateGraph(AgentStateAnnotation)
    .addNode("memory_bootstrap", memoryBootstrapNode)
    .addNode("router", routerNode)
    .addNode(RouteTarget.VISUAL_AGENT, visualAgentNode)
    .addNode(RouteTarget.SALES_AGENT, salesAgentNode)
    .addNode(RouteTarget.ORDER_AGENT, orderAgentNode)
    .addNode(RouteTarget.CHAT_AGENT, chatAgentNode)
    .addNode(RouteTarget.KNOWLEDGE_AGENT, knowledgeAgentNode)
    .addNode("media_describe", mediaDescribeNode)
    .addNode("retrieval", retrievalNode)
    .addNode("clarification_precheck", clarificationPreCheckNode)
    .addNode("clarification_gate", clarificationGateNode)
    .addNode("response_composer", responseComposerNode)
    .addNode("response_reviewer", responseReviewerNode)
    .addNode("confidence_gate", confidenceGateNode)
    .addNode(RouteTarget.HUMAN_HANDOFF, humanHandoffNode)
    .addNode("memory_persist", memoryPersistNode)
    .addEdge(START, "memory_bootstrap")
    .addEdge("memory_bootstrap", "router")
    .addConditionalEdges("router", routerCondition, {
      [RouteTarget.CONVERSATION_CLOSING]: "response_composer",
      [RouteTarget.VISUAL_AGENT]: "media_describe",
      [RouteTarget.ORDER_AGENT]: RouteTarget.ORDER_AGENT,
      [RouteTarget.HUMAN_HANDOFF]: RouteTarget.HUMAN_HANDOFF,
      [RouteTarget.SALES_AGENT]: "clarification_precheck",
      [RouteTarget.KNOWLEDGE_AGENT]: "clarification_precheck",
      [RouteTarget.CHAT_AGENT]: "clarification_precheck",
    })
    // media_describe → retrieval (fixed edge)
    .addEdge("media_describe", "retrieval")
    // clarification_precheck → retrieval or response_composer (conditional)
    .addConditionalEdges("clarification_precheck", preCheckCondition, {
      retrieval: "retrieval",
      response_composer: "response_composer",
    })
    // retrieval → clarification_gate (fixed edge)
    .addEdge("retrieval", "clarification_gate")
    // clarification_gate → domain agent or response_composer (conditional)
    .addConditionalEdges("clarification_gate", gateCondition, {
      [RouteTarget.VISUAL_AGENT]: RouteTarget.VISUAL_AGENT,
      [RouteTarget.SALES_AGENT]: RouteTarget.SALES_AGENT,
      [RouteTarget.KNOWLEDGE_AGENT]: RouteTarget.KNOWLEDGE_AGENT,
      [RouteTarget.CHAT_AGENT]: RouteTarget.CHAT_AGENT,
      response_composer: "response_composer",
    })
    .addEdge(RouteTarget.VISUAL_AGENT, RouteTarget.SALES_AGENT)
    .addEdge(RouteTarget.SALES_AGENT, "response_composer")
    .addEdge(RouteTarget.ORDER_AGENT, "response_composer")
    .addEdge(RouteTarget.CHAT_AGENT, "response_composer")
    .addEdge(RouteTarget.KNOWLEDGE_AGENT, "response_composer")
    .addEdge("response_composer", "response_reviewer")
    .addEdge("response_reviewer", "confidence_gate")
    .addConditionalEdges("confidence_gate", confidenceGateCondition, {
      continue: "memory_persist",
      handoff: RouteTarget.HUMAN_HANDOFF
    })
    .addEdge(RouteTarget.HUMAN_HANDOFF, "memory_persist")
    .addEdge("memory_persist", END);

  return graph.compile();
};
