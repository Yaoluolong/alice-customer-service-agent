import { describe, it, expect } from "vitest";
import { updateIntentStack } from "../../src/nodes/router";
import { RouteTarget } from "../../src/types";

describe("updateIntentStack", () => {
  it("pushes new intent when confidence >= 0.3 and differs from top", () => {
    const result = updateIntentStack([], RouteTarget.SALES_AGENT, 0.8);
    expect(result.stack).toEqual([RouteTarget.SALES_AGENT]);
    expect(result.inherited).toBe(false);
  });

  it("does not duplicate when same as top", () => {
    const result = updateIntentStack([RouteTarget.SALES_AGENT], RouteTarget.SALES_AGENT, 0.8);
    expect(result.stack).toEqual([RouteTarget.SALES_AGENT]);
    expect(result.inherited).toBe(false);
  });

  it("shifts oldest when stack exceeds max depth 3", () => {
    const stack = [RouteTarget.SALES_AGENT, RouteTarget.KNOWLEDGE_AGENT, RouteTarget.ORDER_AGENT];
    const result = updateIntentStack(stack, RouteTarget.CHAT_AGENT, 0.8);
    expect(result.stack).toEqual([RouteTarget.KNOWLEDGE_AGENT, RouteTarget.ORDER_AGENT, RouteTarget.CHAT_AGENT]);
    expect(result.stack).toHaveLength(3);
  });

  it("inherits from stack top when confidence < 0.3 and stack non-empty", () => {
    const result = updateIntentStack([RouteTarget.SALES_AGENT], RouteTarget.CHAT_AGENT, 0.2);
    expect(result.inherited).toBe(true);
    expect(result.inheritedTarget).toBe(RouteTarget.SALES_AGENT);
    expect(result.stack).toEqual([RouteTarget.SALES_AGENT]);
  });

  it("does NOT inherit when confidence < 0.3 but stack is empty", () => {
    const result = updateIntentStack([], RouteTarget.CHAT_AGENT, 0.2);
    expect(result.inherited).toBe(false);
    expect(result.stack).toEqual([RouteTarget.CHAT_AGENT]);
  });

  it("pushes at confidence 0.4 (multi-match, above 0.3)", () => {
    const result = updateIntentStack([RouteTarget.SALES_AGENT], RouteTarget.KNOWLEDGE_AGENT, 0.4);
    expect(result.inherited).toBe(false);
    expect(result.stack).toEqual([RouteTarget.SALES_AGENT, RouteTarget.KNOWLEDGE_AGENT]);
  });

  it("pushes at confidence 0.3 (boundary)", () => {
    const result = updateIntentStack([RouteTarget.SALES_AGENT], RouteTarget.ORDER_AGENT, 0.3);
    expect(result.inherited).toBe(false);
    expect(result.stack).toContain(RouteTarget.ORDER_AGENT);
  });

  it("inherits at confidence 0.29 (just below threshold)", () => {
    const result = updateIntentStack([RouteTarget.KNOWLEDGE_AGENT], RouteTarget.CHAT_AGENT, 0.29);
    expect(result.inherited).toBe(true);
    expect(result.inheritedTarget).toBe(RouteTarget.KNOWLEDGE_AGENT);
  });
});
