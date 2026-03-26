import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from "prom-client";

export const registry = new Registry();

collectDefaultMetrics({ register: registry });

export const chatTotal = new Counter({
  name: "alice_chat_total",
  help: "Total chat invocations",
  labelNames: ["tenant_id", "route"] as const,
  registers: [registry],
});

export const chatDuration = new Histogram({
  name: "alice_chat_duration_seconds",
  help: "Chat processing duration in seconds",
  labelNames: ["tenant_id", "route"] as const,
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [registry],
});

export const confidenceScore = new Histogram({
  name: "alice_confidence_score",
  help: "Agent confidence score distribution",
  buckets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
  registers: [registry],
});

export const handoffTotal = new Counter({
  name: "alice_handoff_total",
  help: "Total human handoff events",
  labelNames: ["tenant_id", "reason"] as const,
  registers: [registry],
});

export const openvikingRequestsTotal = new Counter({
  name: "alice_openviking_requests_total",
  help: "Total requests to OpenViking",
  labelNames: ["method", "status"] as const,
  registers: [registry],
});
