import { describe, it, expect } from "vitest";
import {
  isConversationClosing,
  heuristicClassifyWithConfidence,
} from "../../src/nodes/router";

// ---------- isConversationClosing ----------

describe("isConversationClosing", () => {
  const closingZh = [
    "好的谢谢", "谢谢你", "没有了", "没别的了",
    "就这样", "好的就这样", "不用了谢谢", "可以了谢谢",
  ];

  const closingEn = [
    "thanks that's all", "thank you bye", "no that's it",
    "nothing else thanks", "goodbye", "bye bye",
  ];

  it.each(closingZh)("detects Chinese closing phrase: %s", (phrase) => {
    expect(isConversationClosing(phrase)).toBe(true);
  });

  it.each(closingEn)("detects English closing phrase: %s", (phrase) => {
    expect(isConversationClosing(phrase)).toBe(true);
  });

  it("is case-insensitive for English phrases", () => {
    expect(isConversationClosing("Goodbye")).toBe(true);
    expect(isConversationClosing("GOODBYE")).toBe(true);
    expect(isConversationClosing("Thanks That's All")).toBe(true);
    expect(isConversationClosing("BYE BYE")).toBe(true);
  });

  it("trims whitespace", () => {
    expect(isConversationClosing("  goodbye  ")).toBe(true);
    expect(isConversationClosing("  没有了  ")).toBe(true);
  });

  it("does NOT trigger on standalone '谢谢'", () => {
    expect(isConversationClosing("谢谢")).toBe(false);
  });

  it("does NOT trigger on standalone 'thanks'", () => {
    expect(isConversationClosing("thanks")).toBe(false);
  });

  it("does NOT trigger when closing phrase is embedded in longer message", () => {
    expect(isConversationClosing("好的谢谢，还有一个问题")).toBe(false);
    expect(isConversationClosing("I want to say goodbye to my old phone")).toBe(false);
  });

  it("does NOT trigger on product-related message containing '谢谢'", () => {
    expect(isConversationClosing("谢谢，这个包包有其他颜色吗")).toBe(false);
  });

  it("does NOT trigger on empty string", () => {
    expect(isConversationClosing("")).toBe(false);
    expect(isConversationClosing("   ")).toBe(false);
  });
});

// ---------- heuristicClassifyWithConfidence ----------

describe("heuristicClassifyWithConfidence", () => {
  it("returns single-match confidence 0.8 for product keyword", () => {
    const result = heuristicClassifyWithConfidence("这个包包多少钱", false);
    expect(result.intent).toBe("product_inquiry");
    expect(result.confidence).toBe(0.8);
    expect(result.candidates).toContain("product_inquiry");
  });

  it("returns single-match confidence 0.8 for order keyword", () => {
    const result = heuristicClassifyWithConfidence("我的订单到哪了", false);
    expect(result.intent).toBe("order_status");
    expect(result.confidence).toBe(0.8);
    expect(result.candidates).toContain("order_status");
  });

  it("returns multi-match confidence 0.4 when multiple categories match", () => {
    // "退款" hits knowledge_query, "订单" hits order_status
    const result = heuristicClassifyWithConfidence("我订单的退款怎么处理", false);
    expect(result.confidence).toBe(0.4);
    expect(result.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it("returns no-match confidence 0.2 and UNKNOWN intent", () => {
    const result = heuristicClassifyWithConfidence("今天天气不错", false);
    expect(result.intent).toBe("unknown");
    expect(result.confidence).toBe(0.2);
    expect(result.candidates).toEqual([]);
  });

  it("returns visual_search with 0.8 confidence when hasMedia is true", () => {
    const result = heuristicClassifyWithConfidence("看看这个", true);
    expect(result.intent).toBe("visual_search");
    expect(result.confidence).toBe(0.8);
    expect(result.candidates).toEqual(["visual_search"]);
  });

  it("candidates are sorted by match count descending", () => {
    // "包包多少钱有库存吗" hits product_inquiry (包包, 多少钱, 库存, 包 = 4 matches)
    // "hello" hits general_chat (1 match)
    const result = heuristicClassifyWithConfidence("hello 包包多少钱有库存吗", false);
    expect(result.candidates[0]).toBe("product_inquiry");
  });

  it("candidates limited to top 3", () => {
    // Construct text matching all 4 categories
    const result = heuristicClassifyWithConfidence("退款 订单 包包 你好", false);
    expect(result.candidates.length).toBeLessThanOrEqual(3);
  });

  it("respects keywordOverrides", () => {
    const overrides = { product_inquiry: ["定制"] };
    const result = heuristicClassifyWithConfidence("我要定制", false, overrides);
    expect(result.intent).toBe("product_inquiry");
    expect(result.confidence).toBe(0.8);
  });
});

// ---------- CONVERSATION_CLOSING priority ----------

describe("CONVERSATION_CLOSING priority", () => {
  it("'没有了' should be detected as closing, not classified by keywords", () => {
    // "没有了" could theoretically match some keyword, but closing takes priority
    expect(isConversationClosing("没有了")).toBe(true);
    // The routerNode would check isConversationClosing before heuristicClassify,
    // so closing wins. We verify the pure function here.
  });

  it("'谢谢你' is closing, not general_chat", () => {
    expect(isConversationClosing("谢谢你")).toBe(true);
    // If it were classified by keywords, "谢谢" in general_chat might match.
    // But closing detection runs first in routerNode.
  });
});
