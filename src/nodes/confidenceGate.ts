import { appConfig } from "../config/env";
import { AgentState, RouteTarget, TraceEntry } from "../types";

export type ConfidenceGateDecision = "handoff" | "continue";

export const confidenceGateNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  const threshold = appConfig.confidence.threshold;
  const score = state.agent_confidence;
  const margin = score - threshold;
  const shouldHandoff = state.requires_human || score < threshold;

  const nearMiss = Math.abs(margin) < 0.1 ? { note: "Close to threshold" } : undefined;

  const gateTrace: TraceEntry = {
    node: "gate",
    displayName: "Confidence Gate",
    input: `Score: ${score.toFixed(2)}, Threshold: ${threshold.toFixed(2)}`,
    output: shouldHandoff
      ? `Handoff triggered (margin: ${margin.toFixed(2)})`
      : `Passed (margin: +${margin.toFixed(2)})`,
    metadata: {
      score,
      threshold,
      margin,
      forced: state.requires_human,
      severity: shouldHandoff ? "error" : "ok",
      nearMiss,
    },
  };

  if (shouldHandoff) {
    return {
      requires_human: true,
      route_target: RouteTarget.HUMAN_HANDOFF,
      handoff_reason: state.handoff_reason ?? state.confidence_reasons[0] ?? "当前回复置信度不足",
      trace: [gateTrace]
    };
  }

  return {
    requires_human: false,
    handoff_reason: null,
    trace: [gateTrace]
  };
};

export const confidenceGateCondition = (state: AgentState): ConfidenceGateDecision =>
  state.requires_human ? "handoff" : "continue";
