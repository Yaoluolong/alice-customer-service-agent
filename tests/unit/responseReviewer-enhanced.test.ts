import { describe, it, expect } from "vitest";
import {
  heuristicCompleteness,
  heuristicCoherence,
  heuristicToneMatch,
} from "../../src/nodes/responseReviewer";

describe("heuristicCompleteness", () => {
  it("penalizes when multiple questions but fewer answer segments", () => {
    const penalty = heuristicCompleteness("价格多少？有红色吗？", "我们有红色款式。");
    expect(penalty).toBe(-0.15);
  });

  it("no penalty when single question is fully answered", () => {
    const penalty = heuristicCompleteness("价格多少？", "这款商品的价格是299元，目前还有优惠活动。");
    expect(penalty).toBe(0);
  });

  it("no penalty when no question marks in user message", () => {
    const penalty = heuristicCompleteness("我想看看红色的", "好的，这是我们的红色款式。");
    expect(penalty).toBe(0);
  });

  it("penalizes when 3 questions but only 2 answer segments", () => {
    const penalty = heuristicCompleteness(
      "价格多少？有红色吗？能包邮吗？",
      "价格是299元。我们有红色款式。"
    );
    expect(penalty).toBe(-0.15);
  });

  it("no penalty when answer segments match question count", () => {
    const penalty = heuristicCompleteness(
      "价格多少？有红色吗？",
      "价格是299元。有红色款式的。"
    );
    expect(penalty).toBe(0);
  });
});

describe("heuristicCoherence", () => {
  it("penalizes when summary mentions Chanel but reply is about weather", () => {
    const penalty = heuristicCoherence(
      "客户之前咨询过Chanel手袋的价格和颜色",
      "Today the weather is sunny and warm."
    );
    expect(penalty).toBe(-0.08);
  });

  it("no penalty when summary is empty string", () => {
    const penalty = heuristicCoherence("", "任何回复内容");
    expect(penalty).toBe(0);
  });

  it("no penalty when summary is null", () => {
    const penalty = heuristicCoherence(null, "任何回复内容");
    expect(penalty).toBe(0);
  });

  it("no penalty when reply references context terms", () => {
    const penalty = heuristicCoherence(
      "客户之前咨询过Chanel手袋的价格和颜色",
      "这款Chanel手袋目前售价12000元，有黑色和白色两种颜色。"
    );
    expect(penalty).toBe(0);
  });

  it("no penalty when summary is very short (< 10 chars)", () => {
    const penalty = heuristicCoherence("短摘要", "任何回复内容都可以");
    expect(penalty).toBe(0);
  });
});

describe("heuristicToneMatch", () => {
  it("penalizes urgent tone with casual Chinese response", () => {
    const penalty = heuristicToneMatch("urgent", "慢慢来，不着急，我们会处理的");
    expect(penalty).toBe(-0.10);
  });

  it("penalizes urgent tone with casual English response", () => {
    const penalty = heuristicToneMatch("urgent", "Take your time, we will get back to you.");
    expect(penalty).toBe(-0.10);
  });

  it("no penalty for neutral tone", () => {
    const penalty = heuristicToneMatch("neutral", "慢慢来，不着急");
    expect(penalty).toBe(0);
  });

  it("no penalty for null tone", () => {
    const penalty = heuristicToneMatch(null, "慢慢来，不着急");
    expect(penalty).toBe(0);
  });

  it("no penalty for urgent tone with matching urgency", () => {
    const penalty = heuristicToneMatch("urgent", "我们会立即为您处理，请稍等！");
    expect(penalty).toBe(0);
  });

  it("no penalty for confused tone (only urgent triggers)", () => {
    const penalty = heuristicToneMatch("confused", "慢慢来，不着急");
    expect(penalty).toBe(0);
  });

  it("no penalty for polite tone", () => {
    const penalty = heuristicToneMatch("polite", "Take your time");
    expect(penalty).toBe(0);
  });

  it("no penalty for brief tone", () => {
    const penalty = heuristicToneMatch("brief", "no rush at all");
    expect(penalty).toBe(0);
  });
});

describe("Flag integration", () => {
  it("completeness penalty maps to incomplete_answer flag", () => {
    // Verify the penalty value is correct
    expect(heuristicCompleteness("问题一？问题二？", "只回答了一个问题。")).toBe(-0.15);
  });

  it("coherence penalty maps to incoherent flag", () => {
    expect(heuristicCoherence("讨论关于手机壳的购买事宜和颜色选择", "The sky is blue.")).toBe(-0.08);
  });

  it("tone penalty maps to tone_mismatch flag", () => {
    expect(heuristicToneMatch("urgent", "不急不急慢慢来")).toBe(-0.10);
  });
});
