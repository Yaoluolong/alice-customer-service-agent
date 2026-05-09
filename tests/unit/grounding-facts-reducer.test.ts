import { describe, it, expect } from "vitest";
import { AgentStateAnnotation } from "../../src/graph";
import { UserIntent } from "../../src/types";

// LangGraph stores the reducer function as `operator` in the channel spec
const reducer = (AgentStateAnnotation.spec.grounding_facts as any).operator as (
  existing: any,
  update: any,
) => any;

describe("grounding_facts merge reducer", () => {
  const makeFacts = (overrides: any) => ({
    intent: UserIntent.PRODUCT_INQUIRY,
    facts: [],
    unknowns: [],
    fact_confidence: 0.5,
    next_actions: [],
    ...overrides,
  });

  it("returns update when existing is null", () => {
    const update = makeFacts({ facts: [{ key: "a", value: "1" }] });
    expect(reducer(null, update)).toEqual(update);
  });

  it("returns existing when update is null", () => {
    const existing = makeFacts({ facts: [{ key: "a", value: "1" }] });
    expect(reducer(existing, null)).toEqual(existing);
  });

  it("merges facts arrays from two agents", () => {
    const existing = makeFacts({ facts: [{ key: "visual", value: "red bag" }], fact_confidence: 0.7 });
    const update = makeFacts({ facts: [{ key: "inventory", value: "in stock" }], fact_confidence: 0.9 });
    const merged = reducer(existing, update);
    expect(merged.facts).toHaveLength(2);
    expect(merged.facts[0].key).toBe("visual");
    expect(merged.facts[1].key).toBe("inventory");
  });

  it("uses Math.max for fact_confidence", () => {
    const existing = makeFacts({ fact_confidence: 0.6 });
    const update = makeFacts({ fact_confidence: 0.9 });
    expect(reducer(existing, update).fact_confidence).toBe(0.9);
  });

  it("uses update intent (last writer wins for intent)", () => {
    const existing = makeFacts({ intent: UserIntent.VISUAL_SEARCH });
    const update = makeFacts({ intent: UserIntent.PRODUCT_INQUIRY });
    expect(reducer(existing, update).intent).toBe(UserIntent.PRODUCT_INQUIRY);
  });

  it("merges next_actions and unknowns", () => {
    const existing = makeFacts({ next_actions: ["check inventory"], unknowns: ["size"] });
    const update = makeFacts({ next_actions: ["recommend"], unknowns: ["color"] });
    const merged = reducer(existing, update);
    expect(merged.next_actions).toEqual(["check inventory", "recommend"]);
    expect(merged.unknowns).toEqual(["size", "color"]);
  });
});
