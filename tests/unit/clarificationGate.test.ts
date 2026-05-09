import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/logger", () => ({ default: { info: vi.fn(), warn: vi.fn() } }));

import {
  shouldPreCheckReject,
  shouldGateReject,
  buildClarificationMessage,
} from "../../src/nodes/clarificationGate";

// ---------- shouldPreCheckReject ----------

describe("shouldPreCheckReject", () => {
  it("rejects extremely vague message with low confidence", () => {
    expect(shouldPreCheckReject("嗯", 0.2, ["general_chat"])).toBe(true);
  });

  it("passes when brand entity detected (Chanel)", () => {
    expect(shouldPreCheckReject("Chanel", 0.2, ["product_inquiry"])).toBe(false);
  });

  it("passes when text length >= 8", () => {
    expect(shouldPreCheckReject("我想看看有什么推荐", 0.2, ["product_inquiry"])).toBe(false);
  });

  it("passes when intentConfidence >= 0.4", () => {
    expect(shouldPreCheckReject("嗯", 0.4, ["general_chat"])).toBe(false);
  });

  it("passes when order ID entity detected", () => {
    expect(shouldPreCheckReject("ORD-123", 0.2, ["order_status"])).toBe(false);
  });

  it("passes when price entity detected", () => {
    expect(shouldPreCheckReject("200元", 0.2, ["product_inquiry"])).toBe(false);
  });
});

// ---------- shouldGateReject ----------

describe("shouldGateReject", () => {
  it("rejects when all conditions met", () => {
    expect(shouldGateReject("看看", 0.45, 0.3)).toBe(true);
  });

  it("passes when retrieval score is good (>= 0.4)", () => {
    expect(shouldGateReject("看看", 0.45, 0.6)).toBe(false);
  });

  it("passes when intentConfidence >= 0.5", () => {
    expect(shouldGateReject("看看", 0.5, 0.3)).toBe(false);
  });

  it("passes when text is long (>= 15 chars)", () => {
    expect(shouldGateReject("我想看看有什么好的推荐给我吧啊", 0.45, 0.3)).toBe(false);
  });

  it("passes when brand entity detected (Gucci)", () => {
    expect(shouldGateReject("Gucci", 0.45, 0.3)).toBe(false);
  });
});

// ---------- buildClarificationMessage ----------

describe("buildClarificationMessage", () => {
  it("builds Chinese message with 2 options", () => {
    const msg = buildClarificationMessage(["product_inquiry", "order_status"], "zh-CN");
    expect(msg).toBe("我想确认一下，你是想了解某款商品，还是查看订单状态呢？");
  });

  it("builds English message with 2 options", () => {
    const msg = buildClarificationMessage(["product_inquiry", "knowledge_query"], "en-US");
    expect(msg).toBe(
      "Just to make sure I help you best — are you looking for looking for a product, or checking our policies?"
    );
  });

  it("pads with general_chat when single candidate", () => {
    const msg = buildClarificationMessage(["product_inquiry"], "zh-CN");
    expect(msg).toBe("我想确认一下，你是想了解某款商品，还是随便聊聊呢？");
  });

  it("handles empty candidates by padding with general_chat", () => {
    const msg = buildClarificationMessage([], "zh-CN");
    expect(msg).toBe("我想确认一下，你是想随便聊聊，还是随便聊聊呢？");
  });
});
