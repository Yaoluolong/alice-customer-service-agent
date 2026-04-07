import { describe, it, expect } from "vitest";
import { categoriseMemories } from "../../src/nodes/memoryNode";
import type { SearchItem } from "../../src/types";

function item(uri: string, abstract = ""): SearchItem {
  return { uri, abstract, score: 0.9 };
}

describe("categoriseMemories", () => {
  it("routes profile memories to profile field", () => {
    const result = categoriseMemories([item("viking://user/memories/profile/001")]);
    expect(result.profile).toBeTruthy();
    expect(result.preferences).toHaveLength(0);
  });

  it("routes case memories to cases field (not preferences)", () => {
    const result = categoriseMemories([item("viking://user/memories/cases/001", "purchased Nike shoes")]);
    expect(result.cases).toHaveLength(1);
    expect(result.preferences).toHaveLength(0);
    expect(result.events).toHaveLength(0);
  });

  it("routes pattern memories to patterns field (not preferences)", () => {
    const result = categoriseMemories([item("viking://user/memories/patterns/001", "frequently asks about size")]);
    expect(result.patterns).toHaveLength(1);
    expect(result.preferences).toHaveLength(0);
  });

  it("routes event/purchase/order memories to events field", () => {
    const result = categoriseMemories([item("viking://user/memories/events/order_123")]);
    expect(result.events).toHaveLength(1);
  });

  it("routes milestone memories to events field", () => {
    const result = categoriseMemories([item("viking://user/memories/milestone/first_purchase")]);
    expect(result.events).toHaveLength(1);
  });

  it("falls back unrecognized memories to preferences", () => {
    const result = categoriseMemories([item("viking://user/memories/other/001", "some info")]);
    expect(result.preferences).toHaveLength(1);
  });
});
