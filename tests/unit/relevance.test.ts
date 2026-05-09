import { describe, it, expect } from "vitest";
import { getRelevance } from "../../src/utils/relevance";

describe("getRelevance", () => {
  it("returns 'high' for confidence > 0.7", () => {
    expect(getRelevance(0.85)).toBe("high");
    expect(getRelevance(0.71)).toBe("high");
  });

  it("returns 'medium' for confidence 0.4-0.7", () => {
    expect(getRelevance(0.7)).toBe("medium");
    expect(getRelevance(0.4)).toBe("medium");
    expect(getRelevance(0.55)).toBe("medium");
  });

  it("returns 'low' for confidence < 0.4", () => {
    expect(getRelevance(0.39)).toBe("low");
    expect(getRelevance(0)).toBe("low");
  });
});
