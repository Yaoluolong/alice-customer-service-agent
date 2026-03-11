import { BaseMessage } from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { chatAgentNode } from "./nodes/chatAgent";
import { confidenceGateCondition, confidenceGateNode } from "./nodes/confidenceGate";
import { humanHandoffNode } from "./nodes/humanHandoff";
import { memoryBootstrapNode, memoryPersistNode } from "./nodes/memoryNode";
import { orderAgentNode } from "./nodes/orderAgent";
import { responseComposerNode } from "./nodes/responseComposer";
import { responseReviewerNode } from "./nodes/responseReviewer";
import { routerCondition, routerNode } from "./nodes/router";
import { salesAgentNode } from "./nodes/salesAgent";
import { visualAgentNode } from "./nodes/visualAgent";
import { AgentState, RouteTarget, UserIntent } from "./types";

export const AgentStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (left, right) => left.concat(right),
    default: () => []
  }),
  user_id: Annotation<string>,
  session_id: Annotation<string>,
  user_intent: Annotation<UserIntent>,
  route_target: Annotation<RouteTarget>,
  current_product_id: Annotation<string | null>,
  image_context: Annotation<AgentState["image_context"]>,
  retrieved_products: Annotation<AgentState["retrieved_products"]>,
  user_preferences: Annotation<AgentState["user_preferences"]>,
  requires_human: Annotation<boolean>,
  human_feedback: Annotation<string | undefined>,

  grounding_facts: Annotation<AgentState["grounding_facts"]>,
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

  trace: Annotation<string[]>({
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
    .addNode("response_composer", responseComposerNode)
    .addNode("response_reviewer", responseReviewerNode)
    .addNode("confidence_gate", confidenceGateNode)
    .addNode(RouteTarget.HUMAN_HANDOFF, humanHandoffNode)
    .addNode("memory_persist", memoryPersistNode)
    .addEdge(START, "memory_bootstrap")
    .addEdge("memory_bootstrap", "router")
    .addConditionalEdges("router", routerCondition, {
      [RouteTarget.VISUAL_AGENT]: RouteTarget.VISUAL_AGENT,
      [RouteTarget.SALES_AGENT]: RouteTarget.SALES_AGENT,
      [RouteTarget.ORDER_AGENT]: RouteTarget.ORDER_AGENT,
      [RouteTarget.CHAT_AGENT]: RouteTarget.CHAT_AGENT,
      [RouteTarget.HUMAN_HANDOFF]: RouteTarget.HUMAN_HANDOFF
    })
    .addEdge(RouteTarget.VISUAL_AGENT, RouteTarget.SALES_AGENT)
    .addEdge(RouteTarget.SALES_AGENT, "response_composer")
    .addEdge(RouteTarget.ORDER_AGENT, "response_composer")
    .addEdge(RouteTarget.CHAT_AGENT, "response_composer")
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
