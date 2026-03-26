import assert from "node:assert/strict";
import { confidenceGateCondition, confidenceGateNode } from "../nodes/confidenceGate";
import { AgentState, RouteTarget, UserIntent, createInitialState } from "../types";
import { HumanMessage } from "@langchain/core/messages";

const buildState = (score: number): AgentState => {
  const initial = createInitialState({
    sessionId: "s_test",
    userId: "u_test",
    tenantId: "tenant_test",
    customerId: "u_test",
    userMessage: new HumanMessage("hi")
  });

  return {
    ...initial,
    agent_confidence: score,
    route_target: RouteTarget.SALES_AGENT,
    user_intent: UserIntent.PRODUCT_INQUIRY,
    confidence_reasons: ["score below threshold"]
  };
};

export const runConfidenceGateTests = async (): Promise<void> => {
  const low = await confidenceGateNode(buildState(0.69));
  assert.equal(low.requires_human, true);
  const lowCondition = confidenceGateCondition({ ...buildState(0.69), ...(low as Partial<AgentState>) } as AgentState);
  assert.equal(lowCondition, "handoff");

  const edge = await confidenceGateNode(buildState(0.7));
  assert.equal(edge.requires_human, false);

  const high = await confidenceGateNode(buildState(1));
  assert.equal(high.requires_human, false);
};
