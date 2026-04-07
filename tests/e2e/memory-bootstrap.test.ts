import { describe, it, expect, vi } from "vitest";
import { categoriseMemories, memoryBootstrapNode } from "../../src/nodes/memoryNode";
import type { SearchItem } from "../../src/types";
import { HumanMessage } from "@langchain/core/messages";
import { OpenVikingHttpClient } from "../../src/clients/openviking-client";

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

describe("memoryBootstrap – dual-query & limit", () => {
  const emptyResult = { memories: [], resources: [], skills: [], total: 0 };

  const makeState = (text = "你好") => ({
    tenant_id: "t1",
    customer_id: "c1",
    messages: [new HumanMessage(text)],
    openviking_session_id: null,
    openviking_message_count: 0,
    memory_context: null,
    conversation_summary: "",
    style_profile: null,
    intent: null,
    route: null,
    grounding_facts: null,
    draft_reply: null,
    final_reply: null,
    product_id: null,
    confidence: null,
    review_flags: [],
    handoff_reason: null,
    trace: [],
    media_context: null,
  });

  /**
   * Create a mock OV client that passes the `instanceof OpenVikingHttpClient` check
   * used inside resolveOvClient. We use Object.create to inherit the prototype
   * while keeping full control over methods via vi.fn().
   */
  const makeMockOvClient = (overrides: Partial<OpenVikingHttpClient> = {}): OpenVikingHttpClient => {
    const client = Object.create(OpenVikingHttpClient.prototype) as OpenVikingHttpClient;
    client.listSessions = vi.fn().mockResolvedValue([]) as any;
    client.createSession = vi.fn().mockResolvedValue({ session_id: "ov_test_001" }) as any;
    client.search = vi.fn().mockResolvedValue(emptyResult) as any;
    client.findMemories = vi.fn().mockResolvedValue(emptyResult) as any;
    Object.assign(client, overrides);
    return client;
  };

  it("calls search twice (contextual + baseline) during bootstrap", async () => {
    const searchMock = vi.fn().mockResolvedValue(emptyResult);
    const ovClient = makeMockOvClient({ search: searchMock as any });

    const config = { configurable: { ovClient } };
    await memoryBootstrapNode(makeState(), config);

    expect(searchMock).toHaveBeenCalledTimes(2);
  });

  it("contextual search call uses limit=70", async () => {
    const searchMock = vi.fn().mockResolvedValue(emptyResult);
    const ovClient = makeMockOvClient({ search: searchMock as any });

    const config = { configurable: { ovClient } };
    await memoryBootstrapNode(makeState("你好"), config);

    const limits = searchMock.mock.calls.map((args) => args[5]);
    expect(limits).toContain(70);
  });

  it("baseline profile search call uses limit=30", async () => {
    const searchMock = vi.fn().mockResolvedValue(emptyResult);
    const ovClient = makeMockOvClient({ search: searchMock as any });

    const config = { configurable: { ovClient } };
    await memoryBootstrapNode(makeState("你好"), config);

    const limits = searchMock.mock.calls.map((args) => args[5]);
    expect(limits).toContain(30);
  });

  it("the limit=30 call uses a query containing 'profile'", async () => {
    const searchMock = vi.fn().mockResolvedValue(emptyResult);
    const ovClient = makeMockOvClient({ search: searchMock as any });

    const config = { configurable: { ovClient } };
    await memoryBootstrapNode(makeState("你好"), config);

    const baselineCall = searchMock.mock.calls.find((args) => args[5] === 30);
    expect(baselineCall).toBeDefined();
    expect(baselineCall![2]).toContain("profile");
  });

  it("falls back to findMemories when both search calls fail", async () => {
    const searchMock = vi.fn().mockRejectedValue(new Error("OV down"));
    const findMock = vi.fn().mockResolvedValue(emptyResult);
    const ovClient = makeMockOvClient({ search: searchMock as any, findMemories: findMock as any });

    const config = { configurable: { ovClient } };
    await memoryBootstrapNode(makeState("你好"), config);

    expect(findMock).toHaveBeenCalledOnce();
    expect(findMock).toHaveBeenCalledWith(
      "t1", "c1",
      expect.any(String),
      "viking://user/memories/",
      100
    );
  });

  it("deduplicates memories from both search results by URI", async () => {
    const sharedItem: SearchItem = { uri: "viking://user/memories/profile/001", abstract: "shared", score: 0.9 };
    const searchMock = vi.fn().mockResolvedValue({
      memories: [sharedItem],
      resources: [],
      skills: [],
      total: 1,
    });
    const ovClient = makeMockOvClient({ search: searchMock as any });

    const config = { configurable: { ovClient } };
    const result = await memoryBootstrapNode(makeState("你好"), config);

    // The trace contains "lt:N" where N is the number of long-term items loaded
    const trace = result.trace ?? [];
    const ltEntry = trace.find((t) => t.startsWith("memory:bootstrap="));
    expect(ltEntry).toMatch(/lt:1$/); // deduped: only 1 unique item despite 2 calls
  });
});

describe("memoryBootstrap – session recovery detection", () => {
  const emptyResult = { memories: [], resources: [], skills: [], total: 0 };

  /** State with no prior Alice session and empty message history — the recovery scenario. */
  const makeRecoveryState = () => ({
    tenant_id: "t1",
    customer_id: "c1",
    messages: [],
    openviking_session_id: null,
    openviking_message_count: 0,
    memory_context: null,
    conversation_summary: "",
    style_profile: null,
    intent: null,
    route: null,
    grounding_facts: null,
    draft_reply: null,
    final_reply: null,
    product_id: null,
    confidence: null,
    review_flags: [],
    handoff_reason: null,
    trace: [],
    media_context: null,
  });

  const makeMockOvClient = (overrides: Partial<OpenVikingHttpClient> = {}): OpenVikingHttpClient => {
    const client = Object.create(OpenVikingHttpClient.prototype) as OpenVikingHttpClient;
    client.listSessions = vi.fn().mockResolvedValue([]) as any;
    client.createSession = vi.fn().mockResolvedValue({ session_id: "ov_recovery_001" }) as any;
    client.search = vi.fn().mockResolvedValue(emptyResult) as any;
    client.findMemories = vi.fn().mockResolvedValue(emptyResult) as any;
    Object.assign(client, overrides);
    return client;
  };

  it("detects session recovery when Alice has no history but OV has messages", async () => {
    const ovClient = makeMockOvClient({
      listSessions: vi.fn().mockResolvedValue([
        { session_id: "ov_existing", status: "active", message_count: 10, updated_at: new Date().toISOString() }
      ]) as any,
    });

    const config = { configurable: { ovClient } };
    const result = await memoryBootstrapNode(makeRecoveryState(), config);

    const trace = result.trace ?? [];
    const ltEntry = trace.find((t) => t.startsWith("memory:bootstrap="));
    expect(ltEntry).toContain("recovery");
    expect(ltEntry).toContain("ov_existing");
  });

  it("does NOT flag recovery when OV session has 0 messages", async () => {
    const ovClient = makeMockOvClient({
      listSessions: vi.fn().mockResolvedValue([
        { session_id: "ov_empty", status: "active", message_count: 0, updated_at: new Date().toISOString() }
      ]) as any,
    });

    const config = { configurable: { ovClient } };
    const result = await memoryBootstrapNode(makeRecoveryState(), config);

    const trace = result.trace ?? [];
    const ltEntry = trace.find((t) => t.startsWith("memory:bootstrap="));
    expect(ltEntry).not.toContain("recovery");
  });

  it("does NOT flag recovery when Alice already has messages in state", async () => {
    const stateWithMessages = {
      ...makeRecoveryState(),
      messages: [new HumanMessage("hello")],
    };
    const ovClient = makeMockOvClient({
      listSessions: vi.fn().mockResolvedValue([
        { session_id: "ov_existing", status: "active", message_count: 5, updated_at: new Date().toISOString() }
      ]) as any,
    });

    const config = { configurable: { ovClient } };
    const result = await memoryBootstrapNode(stateWithMessages, config);

    const trace = result.trace ?? [];
    const ltEntry = trace.find((t) => t.startsWith("memory:bootstrap="));
    expect(ltEntry).not.toContain("recovery");
  });
});
