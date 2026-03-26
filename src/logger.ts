import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  name: "alice",
});

/**
 * Create a child logger with request context (correlationId, tenantId, customerId).
 */
export function childLogger(ctx: {
  correlationId?: string;
  tenantId?: string;
  customerId?: string;
}): pino.Logger {
  return logger.child(ctx);
}
