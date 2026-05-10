import { describe, it, expect } from "vitest";
import { getBaselineQuery } from "../../src/nodes/memoryNode";

describe("getBaselineQuery", () => {
  it("returns sales baseline for sales_agent (zh)", () => {
    const q = getBaselineQuery("sales_agent", "zh-CN");
    expect(q).toContain("购买历史");
    expect(q).toContain("品牌偏好");
  });

  it("returns sales baseline for visual_agent (zh)", () => {
    const q = getBaselineQuery("visual_agent", "zh-CN");
    expect(q).toContain("品牌偏好");
  });

  it("returns knowledge baseline (zh)", () => {
    const q = getBaselineQuery("knowledge_agent", "zh-CN");
    expect(q).toContain("退换货");
    expect(q).toContain("投诉");
  });

  it("returns order baseline (zh)", () => {
    const q = getBaselineQuery("order_agent", "zh-CN");
    expect(q).toContain("订单");
    expect(q).toContain("物流");
  });

  it("returns default for null (empty stack)", () => {
    expect(getBaselineQuery(null, "zh-CN")).toBe("user profile preferences history milestone purchases");
  });

  it("returns default for null (en)", () => {
    expect(getBaselineQuery(null, "en-US")).toBe("user profile preferences history milestone purchases");
  });

  it("returns English sales baseline", () => {
    const q = getBaselineQuery("sales_agent", "en-US");
    expect(q).toContain("purchase history");
    expect(q).toContain("brand preference");
  });

  it("returns English knowledge baseline", () => {
    const q = getBaselineQuery("knowledge_agent", "en-US");
    expect(q).toContain("returns");
    expect(q).toContain("complaints");
  });

  it("returns English order baseline", () => {
    const q = getBaselineQuery("order_agent", "en-US");
    expect(q).toContain("orders");
    expect(q).toContain("logistics");
  });

  it("returns default for unknown intent", () => {
    expect(getBaselineQuery("some_unknown", "zh-CN")).toBe("user profile preferences history milestone purchases");
  });
});
