import { describe, it, expect, vi } from "vitest";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { memoryPersistNode } from "../../src/nodes/memoryNode";
import { OpenVikingHttpClient } from "../../src/clients/openviking-client";
import type { AgentState } from "../../src/types";

/**
 * Create a mock OV client that passes the `instanceof OpenVikingHttpClient` check
 * used inside resolveOvClient. We use Object.create to inherit the prototype
 * while keeping full control over methods via vi.fn().
 */
const makeMockOvClient = (overrides: Partial<OpenVikingHttpClient> = {}): OpenVikingHttpClient => {
  const client = Object.create(OpenVikingHttpClient.prototype) as OpenVikingHttpClient;
  client.addMessage = vi.fn().mockResolvedValue(undefined) as any;
  client.sessionUsed = vi.fn().mockResolvedValue(undefined) as any;
  client.commitSession = vi.fn().mockResolvedValue(undefined) as any;
  client.listSessions = vi.fn().mockResolvedValue([]) as any;
  client.createSession = vi.fn().mockResolvedValue({ session_id: "ov_test_001" }) as any;
  client.search = vi.fn().mockResolvedValue({ memories: [], resources: [], skills: [], total: 0 }) as any;
  Object.assign(client, overrides);
  return client;
};

const makePersistState = (overrides = {}): AgentState => ({
  tenant_id: "t1",
  customer_id: "c1",
  openviking_session_id: "ov_sess_persist_001",
  openviking_message_count: 5,
  messages: [
    new HumanMessage("我想买跑鞋"),
    new AIMessage("为您推荐 Nike Air Max"),
  ],
  grounding_facts: null,
  media_context: null,
  image_context: null,
  user_id: "u1",
  session_id: "alice_sess_001",
  tenant_config: null,
  user_intent: null as any,
  route_target: null as any,
  current_product_id: null,
  retrieved_products: [],
  memory_context: null,
  user_preferences: [],
  draft_reply: null,
  tone_applied: null,
  variation_id: null,
  agent_confidence: 0.8,
  review_flags: [],
  confidence_reasons: [],
  requires_human: false,
  handoff_reason: null,
  reply_language: "zh-CN",
  style_profile: null as any,
  trace: [],
  conversation_summary: null,
  recent_opening_templates: [],
  ...overrides,
} as AgentState);

describe("memoryPersistNode – P-01 through P-07", () => {
  // P-01: 正常对话写入 user + assistant 消息
  it("P-01: writes user and assistant messages, increments message count", async () => {
    const addMessageMock = vi.fn().mockResolvedValue(undefined);
    const ovClient = makeMockOvClient({ addMessage: addMessageMock as any });

    const state = makePersistState();
    const config = { configurable: { ovClient } };

    const result = await memoryPersistNode(state, config);

    expect(addMessageMock).toHaveBeenCalledTimes(2);
    // First call should be the user role
    expect(addMessageMock.mock.calls[0][3]).toBe("user");
    // Second call should be the assistant role
    expect(addMessageMock.mock.calls[1][3]).toBe("assistant");
    // Message count: 5 initial + 2 persisted = 7
    expect(result.openviking_message_count).toBe(7);
  });

  // P-02: assistant 引用 viking:// 商品时附带 ContextPart 并上报 used
  it("P-02: attaches ContextPart and calls sessionUsed with viking:// URI", async () => {
    const addMessageMock = vi.fn().mockResolvedValue(undefined);
    const sessionUsedMock = vi.fn().mockResolvedValue(undefined);
    const ovClient = makeMockOvClient({
      addMessage: addMessageMock as any,
      sessionUsed: sessionUsedMock as any,
    });

    const state = makePersistState({
      grounding_facts: {
        intent: null,
        facts: [
          {
            key: "product",
            value: "Nike Air Max 详情",
            source: "retrieval",
            confidence: 0.9,
            sourceUri: "viking://resources/products/nike-990",
          },
        ],
        unknowns: [],
        next_actions: [],
        fact_confidence: 0.9,
      },
    });

    const config = { configurable: { ovClient } };
    await memoryPersistNode(state, config);

    // Find the assistant addMessage call
    const assistantCall = addMessageMock.mock.calls.find((args) => args[3] === "assistant");
    expect(assistantCall).toBeDefined();
    const parts: any[] = assistantCall![4];
    const contextPart = parts.find((p: any) => p.type === "context");
    expect(contextPart).toBeDefined();
    expect(contextPart.uri).toBe("viking://resources/products/nike-990");

    // sessionUsed should be called — it's non-blocking fire-and-forget so give a tick
    await new Promise((r) => setTimeout(r, 10));
    expect(sessionUsedMock).toHaveBeenCalledOnce();
    const usedArgs = sessionUsedMock.mock.calls[0];
    const urisArg: string[] = usedArgs[3];
    expect(urisArg).toContain("viking://resources/products/nike-990");
  });

  // P-03: 非 viking:// 来源不出现在 used 上报中
  it("P-03: non-viking:// URIs are excluded from sessionUsed report", async () => {
    const sessionUsedMock = vi.fn().mockResolvedValue(undefined);
    const ovClient = makeMockOvClient({
      addMessage: vi.fn().mockResolvedValue(undefined) as any,
      sessionUsed: sessionUsedMock as any,
    });

    const state = makePersistState({
      grounding_facts: {
        intent: null,
        facts: [
          {
            key: "stock",
            value: "50件",
            source: "inventory",
            confidence: 0.9,
            sourceUri: undefined,
          },
          {
            key: "product",
            value: "Nike详情",
            source: "retrieval",
            confidence: 0.9,
            sourceUri: "viking://resources/products/001",
          },
        ],
        unknowns: [],
        next_actions: [],
        fact_confidence: 0.9,
      },
    });

    const config = { configurable: { ovClient } };
    await memoryPersistNode(state, config);

    await new Promise((r) => setTimeout(r, 10));
    expect(sessionUsedMock).toHaveBeenCalledOnce();
    const urisArg: string[] = sessionUsedMock.mock.calls[0][3];
    expect(urisArg).toContain("viking://resources/products/001");
    expect(urisArg).toHaveLength(1);
  });

  // P-04: 重复 sourceUri 时 used 去重
  it("P-04: deduplicates repeated sourceUris before calling sessionUsed", async () => {
    const sessionUsedMock = vi.fn().mockResolvedValue(undefined);
    const ovClient = makeMockOvClient({
      addMessage: vi.fn().mockResolvedValue(undefined) as any,
      sessionUsed: sessionUsedMock as any,
    });

    const state = makePersistState({
      grounding_facts: {
        intent: null,
        facts: [
          {
            key: "p1",
            value: "A",
            source: "retrieval",
            confidence: 0.9,
            sourceUri: "viking://resources/products/001",
          },
          {
            key: "p2",
            value: "B",
            source: "retrieval",
            confidence: 0.9,
            sourceUri: "viking://resources/products/001",
          },
        ],
        unknowns: [],
        next_actions: [],
        fact_confidence: 0.9,
      },
    });

    const config = { configurable: { ovClient } };
    await memoryPersistNode(state, config);

    await new Promise((r) => setTimeout(r, 10));
    expect(sessionUsedMock).toHaveBeenCalledOnce();
    const urisArg: string[] = sessionUsedMock.mock.calls[0][3];
    expect(urisArg).toHaveLength(1);
    expect(urisArg[0]).toBe("viking://resources/products/001");
  });

  // P-05: addMessage 失败时 reply 流程不中断
  it("P-05: does not throw when addMessage rejects; trace contains persist=error", async () => {
    const ovClient = makeMockOvClient({
      addMessage: vi.fn().mockRejectedValue(new Error("OV write failed")) as any,
    });

    const state = makePersistState();
    const config = { configurable: { ovClient } };

    const result = await memoryPersistNode(state, config);

    expect(result).toBeDefined();
    expect(result.trace).toContain("memory:persist=error");
  });

  // P-06: sessionUsed 失败时不影响结果
  it("P-06: sessionUsed failure does not throw or affect message count", async () => {
    const sessionUsedMock = vi.fn().mockRejectedValue(new Error("sessionUsed failed"));
    const ovClient = makeMockOvClient({
      addMessage: vi.fn().mockResolvedValue(undefined) as any,
      sessionUsed: sessionUsedMock as any,
    });

    const state = makePersistState({
      grounding_facts: {
        intent: null,
        facts: [
          {
            key: "product",
            value: "Nike Air Max",
            source: "retrieval",
            confidence: 0.9,
            sourceUri: "viking://resources/products/nike-990",
          },
        ],
        unknowns: [],
        next_actions: [],
        fact_confidence: 0.9,
      },
    });

    const config = { configurable: { ovClient } };

    let result: Partial<AgentState> | undefined;
    await expect(async () => {
      result = await memoryPersistNode(state, config);
    }).not.toThrow();

    // Give time for the fire-and-forget rejection to settle
    await new Promise((r) => setTimeout(r, 10));

    expect(result).toBeDefined();
    // persist succeeded (2 messages written), message count should be defined
    expect(result!.openviking_message_count).toBeDefined();
    expect(result!.openviking_message_count).toBeGreaterThan(0);
  });

  // P-07: local_ session 跳过所有持久化
  it("P-07: skips all persistence for local_ session IDs", async () => {
    const addMessageMock = vi.fn().mockResolvedValue(undefined);
    const ovClient = makeMockOvClient({ addMessage: addMessageMock as any });

    const state = makePersistState({
      openviking_session_id: "local_1234567890",
    });
    const config = { configurable: { ovClient } };

    const result = await memoryPersistNode(state, config);

    expect(addMessageMock).not.toHaveBeenCalled();
    expect(result.trace).toContain("memory:persist=skipped(no-session)");
    expect(result.openviking_message_count).toBe(0);
  });
});
