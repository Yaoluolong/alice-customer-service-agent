import { describe, it, expect } from "vitest";
import { parseCoTResponse, getOverallRelevance } from "../../src/nodes/responseComposer";

describe("parseCoTResponse", () => {
  it("extracts thinking and reply blocks", () => {
    const raw = "<thinking>User wants product info</thinking><reply>Here is the product info.</reply>";
    const result = parseCoTResponse(raw);
    expect(result.thinking).toBe("User wants product info");
    expect(result.reply).toBe("Here is the product info.");
    expect(result.formatMiss).toBe(false);
  });

  it("truncates thinking at 500 chars", () => {
    const longThinking = "x".repeat(600);
    const raw = `<thinking>${longThinking}</thinking><reply>Short reply.</reply>`;
    const result = parseCoTResponse(raw);
    expect(result.thinking).toHaveLength(500);
    expect(result.reply).toBe("Short reply.");
    expect(result.formatMiss).toBe(false);
  });

  it("returns entire text as reply if no tags found (formatMiss=true)", () => {
    const raw = "Just a plain text response without any tags.";
    const result = parseCoTResponse(raw);
    expect(result.thinking).toBeNull();
    expect(result.reply).toBe(raw);
    expect(result.formatMiss).toBe(true);
  });

  it("handles reply tag without thinking tag", () => {
    const raw = "<reply>Direct reply without thinking.</reply>";
    const result = parseCoTResponse(raw);
    expect(result.thinking).toBeNull();
    expect(result.reply).toBe("Direct reply without thinking.");
    expect(result.formatMiss).toBe(false);
  });

  it("handles empty thinking block", () => {
    const raw = "<thinking></thinking><reply>The actual reply.</reply>";
    const result = parseCoTResponse(raw);
    expect(result.thinking).toBe("");
    expect(result.reply).toBe("The actual reply.");
    expect(result.formatMiss).toBe(false);
  });

  it("handles multiline content in both blocks", () => {
    const raw = "<thinking>Line 1\nLine 2\nLine 3</thinking><reply>Reply line 1\nReply line 2</reply>";
    const result = parseCoTResponse(raw);
    expect(result.thinking).toBe("Line 1\nLine 2\nLine 3");
    expect(result.reply).toBe("Reply line 1\nReply line 2");
    expect(result.formatMiss).toBe(false);
  });

  it("trims whitespace from thinking and reply", () => {
    const raw = "<thinking>  spaced thinking  </thinking><reply>  spaced reply  </reply>";
    const result = parseCoTResponse(raw);
    expect(result.thinking).toBe("spaced thinking");
    expect(result.reply).toBe("spaced reply");
  });

  it("trims the raw text when formatMiss is true", () => {
    const raw = "  some text with spaces  ";
    const result = parseCoTResponse(raw);
    expect(result.reply).toBe("some text with spaces");
    expect(result.formatMiss).toBe(true);
  });
});

describe("getOverallRelevance", () => {
  it("returns 'high' when > 0.7", () => {
    expect(getOverallRelevance(0.85)).toBe("high");
    expect(getOverallRelevance(0.71)).toBe("high");
    expect(getOverallRelevance(1.0)).toBe("high");
  });

  it("returns 'medium' when 0.4-0.7", () => {
    expect(getOverallRelevance(0.7)).toBe("medium");
    expect(getOverallRelevance(0.4)).toBe("medium");
    expect(getOverallRelevance(0.55)).toBe("medium");
  });

  it("returns 'low' when < 0.4", () => {
    expect(getOverallRelevance(0.39)).toBe("low");
    expect(getOverallRelevance(0.0)).toBe("low");
    expect(getOverallRelevance(0.1)).toBe("low");
  });
});
