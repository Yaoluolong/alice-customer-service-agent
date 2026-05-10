import { describe, it, expect } from "vitest";
import { shouldCommitOnGap, GAP_THRESHOLD_MS } from "../../src/service";

describe("shouldCommitOnGap", () => {
  it("returns true when gap > 30 minutes and session exists", () => {
    const lastTimestamp = Date.now() - 31 * 60 * 1000;
    expect(shouldCommitOnGap(lastTimestamp, "sess_123")).toBe(true);
  });

  it("returns false when gap < 30 minutes", () => {
    const lastTimestamp = Date.now() - 10 * 60 * 1000;
    expect(shouldCommitOnGap(lastTimestamp, "sess_123")).toBe(false);
  });

  it("returns false when no session ID", () => {
    const lastTimestamp = Date.now() - 31 * 60 * 1000;
    expect(shouldCommitOnGap(lastTimestamp, null)).toBe(false);
  });

  it("returns false when timestamp is 0 (first message)", () => {
    expect(shouldCommitOnGap(0, "sess_123")).toBe(false);
  });

  it("returns false for local_ session ID", () => {
    const lastTimestamp = Date.now() - 31 * 60 * 1000;
    expect(shouldCommitOnGap(lastTimestamp, "local_123")).toBe(false);
  });

  it("returns true at exactly 30 minutes + 1ms", () => {
    const lastTimestamp = Date.now() - GAP_THRESHOLD_MS - 1;
    expect(shouldCommitOnGap(lastTimestamp, "sess_123")).toBe(true);
  });
});
