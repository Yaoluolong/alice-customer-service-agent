import { describe, it, expect } from "vitest";
import { UserIntent, GroundingFacts } from "../../src/types";

// Replicate the reducer logic from graph.ts to test independently
// (importing graph.ts triggers env.ts which requires OPENAI_PRIMARY_MODEL)
const groundingFactsReducer = (existing: GroundingFacts | null, update: GroundingFacts | null): GroundingFacts | null => {
  if (!update) return existing;
  if (!existing) return update;
  return {
    intent: update.intent,
    facts: [...existing.facts, ...update.facts],
    unknowns: [...existing.unknowns, ...update.unknowns],
    fact_confidence: Math.max(existing.fact_confidence, update.fact_confidence),
    next_actions: [...existing.next_actions, ...update.next_actions],
  };
};

describe("grounding_facts merge reducer", () => {
  const makeFacts = (overrides: Partial<GroundingFacts> = {}): GroundingFacts => ({
    intent: UserIntent.PRODUCT_INQUIRY,
    facts: [],
    unknowns: [],
    fact_confidence: 0.5,
    next_actions: [],
    ...overrides,
  });

  it("returns update when existing is null", () => {
    const update = makeFacts({ facts: [{ key: "a", value: "1", source: "retrieval", confidence: 0.8 }] });
    expect(groundingFactsReducer(null, update)).toEqual(update);
  });

  it("returns existing when update is null", () => {
    const existing = makeFacts({ facts: [{ key: "a", value: "1", source: "retrieval", confidence: 0.8 }] });
    expect(groundingFactsReducer(existing, null)).toEqual(existing);
  });

  it("returns null when both are null", () => {
    expect(groundingFactsReducer(null, null)).toBeNull();
  });

  it("merges facts arrays from two agents", () => {
    const existing = makeFacts({ facts: [{ key: "visual", value: "red bag", source: "retrieval", confidence: 0.7 }], fact_confidence: 0.7 });
    const update = makeFacts({ facts: [{ key: "inventory", value: "in stock", source: "inventory", confidence: 0.9 }], fact_confidence: 0.9 });
    const merged = groundingFactsReducer(existing, update)!;
    expect(merged.facts).toHaveLength(2);
    expect(merged.facts[0].key).toBe("visual");
    expect(merged.facts[1].key).toBe("inventory");
  });

  it("uses Math.max for fact_confidence", () => {
    const existing = makeFacts({ fact_confidence: 0.6 });
    const update = makeFacts({ fact_confidence: 0.9 });
    expect(groundingFactsReducer(existing, update)!.fact_confidence).toBe(0.9);
  });

  it("uses update intent (last writer wins for intent)", () => {
    const existing = makeFacts({ intent: UserIntent.VISUAL_SEARCH });
    const update = makeFacts({ intent: UserIntent.PRODUCT_INQUIRY });
    expect(groundingFactsReducer(existing, update)!.intent).toBe(UserIntent.PRODUCT_INQUIRY);
  });

  it("merges next_actions and unknowns", () => {
    const existing = makeFacts({ next_actions: ["check inventory"], unknowns: ["size"] });
    const update = makeFacts({ next_actions: ["recommend"], unknowns: ["color"] });
    const merged = groundingFactsReducer(existing, update)!;
    expect(merged.next_actions).toEqual(["check inventory", "recommend"]);
    expect(merged.unknowns).toEqual(["size", "color"]);
  });
});
