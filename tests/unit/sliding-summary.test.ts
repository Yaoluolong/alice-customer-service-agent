import { describe, it, expect, vi, beforeEach } from "vitest";
import { BaseMessage, HumanMessage, AIMessage } from "@langchain/core/messages";

const mockInvoke = vi.fn().mockResolvedValue({
  content: "用户询问了红色Chanel手袋的价格和库存，偏好M码，已确认下单意向。"
});

vi.mock("../../src/config/models", () => ({
  getConfiguredModel: () => ({
    invoke: mockInvoke,
  }),
}));
vi.mock("../../src/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/config/persona", () => ({
  getSummaryInstruction: () => "Summarize this conversation in 100 words.",
}));

// Must import AFTER mocks
const { generateSlidingSummary } = await import("../../src/nodes/memoryNode");

describe("generateSlidingSummary", () => {
  const messages: BaseMessage[] = [
    new HumanMessage("你好，我想看看包"),
    new AIMessage("你好！我们有很多款式，你喜欢什么颜色？"),
    new HumanMessage("红色的Chanel有吗"),
    new AIMessage("有的，这款红色Chanel手袋..."),
  ];

  beforeEach(() => {
    mockInvoke.mockClear();
  });

  it("generates summary via LLM", async () => {
    const result = await generateSlidingSummary(messages, "zh-CN");
    expect(result).toContain("红色Chanel手袋");
    expect(mockInvoke).toHaveBeenCalledOnce();
  });

  it("returns null for empty messages", async () => {
    const result = await generateSlidingSummary([], "zh-CN");
    expect(result).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
