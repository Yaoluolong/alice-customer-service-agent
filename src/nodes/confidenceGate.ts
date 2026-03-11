import { appConfig } from "../config/env";
import { AgentState, RouteTarget } from "../types";

export type ConfidenceGateDecision = "handoff" | "continue";

export const confidenceGateNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  const shouldHandoff = state.requires_human || state.agent_confidence < appConfig.confidence.threshold;

  if (shouldHandoff) {
    return {
      requires_human: true,
      route_target: RouteTarget.HUMAN_HANDOFF,
      handoff_reason: state.handoff_reason ?? state.confidence_reasons[0] ?? "当前回复置信度不足",
      trace: [`gate:handoff@${state.agent_confidence.toFixed(2)}`]
    };
  }

  return {
    requires_human: false,
    handoff_reason: null,
    trace: [`gate:continue@${state.agent_confidence.toFixed(2)}`]
  };
};

export const confidenceGateCondition = (state: AgentState): ConfidenceGateDecision =>
  state.requires_human ? "handoff" : "continue";
