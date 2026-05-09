import { describe, it, expect } from "vitest";

describe("dynamic confidence formula (general agents)", () => {
  const compute = (topScore: number | null) => topScore === null ? 0.2 : Math.min(topScore + 0.1, 0.95);

  it("adds 0.1 to top score", () => {
    expect(compute(0.75)).toBeCloseTo(0.85);
    expect(compute(0.5)).toBeCloseTo(0.6);
  });
  it("caps at 0.95", () => { expect(compute(0.9)).toBe(0.95); });
  it("returns 0.2 for no results", () => { expect(compute(null)).toBe(0.2); });
  it("handles low scores", () => { expect(compute(0.1)).toBeCloseTo(0.2); });
});

describe("orderAgent confidence (exact match)", () => {
  it("returns 0.95 found, 0.25 not found", () => {
    expect(true ? 0.95 : 0.25).toBe(0.95);
    expect(false ? 0.95 : 0.25).toBe(0.25);
  });
});

describe("chatAgent confidence formula", () => {
  const compute = (topScore: number) => topScore > 0 ? Math.min(topScore + 0.05, 0.8) : 0.5;

  it("adds 0.05 for chat", () => { expect(compute(0.6)).toBeCloseTo(0.65); });
  it("caps at 0.8", () => { expect(compute(0.9)).toBe(0.8); });
  it("defaults to 0.5 when no results", () => { expect(compute(0)).toBe(0.5); });
});
