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

  // M-06: search 和 findMemories 均失败时记忆为空但对话继续
  it("proceeds with empty memories when both search and findMemories fail", async () => {
    const ovClient = makeMockOvClient({
      search: vi.fn().mockRejectedValue(new Error("OV unavailable")) as any,
      findMemories: vi.fn().mockRejectedValue(new Error("OV unavailable")) as any,
    });
    const config = { configurable: { ovClient } };
    const result = await memoryBootstrapNode(makeState("你好"), config);

    // Should not throw, returns state with empty long-term memories
    expect(result.memory_context?.longTerm.profile).toBeNull();
    expect(result.memory_context?.longTerm.preferences).toHaveLength(0);
    // memoriesLoaded trace should show lt:0
    const trace = result.trace ?? [];
    const ltEntry = trace.find((t) => t.startsWith("memory:bootstrap="));
    expect(ltEntry).toMatch(/lt:0/);
    // Session was still created (OV session API works, only search fails)
    expect(result.openviking_session_id).toBeTruthy();
  });

  // M-07: 接近 100 条记忆时系统稳定
  it("handles up to 100 memories without errors", async () => {
    // 70 contextual + 30 baseline (no overlap) = 100 total
    const makeItems = (prefix: string, count: number): SearchItem[] =>
      Array.from({ length: count }, (_, i) => ({
        uri: `viking://user/memories/${prefix}/${i}`,
        abstract: `memory ${i}`,
        score: Math.random(),
      }));

    let callCount = 0;
    const ovClient = makeMockOvClient({
      search: vi.fn().mockImplementation(() => {
        callCount++;
        // first call (contextual): 70 items; second call (baseline): 30 items
        const items = callCount === 1
          ? makeItems("contextual", 70)
          : makeItems("baseline", 30);
        return Promise.resolve({ memories: items, resources: [], skills: [], total: items.length });
      }) as any,
    });

    const config = { configurable: { ovClient } };
    const result = await memoryBootstrapNode(makeState("你好"), config);

    // No throw, session created
    expect(result.openviking_session_id).toBeTruthy();
    // All 100 memories loaded (70 + 30 unique URIs)
    const trace = result.trace ?? [];
    const ltEntry = trace.find((t) => t.startsWith("memory:bootstrap="));
    expect(ltEntry).toMatch(/lt:100/);
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
/**
 * Memory Bootstrap E2E Tests
 *
 * Tests the Alice → OpenViking memory bootstrap flow including:
 * - Session acquisition (new / existing / committed / recovery)
 * - Memory loading and categorization
 * - OV degradation paths
 * - Persist message flow
 *
 * Run: cd Alice && npm run test:e2e
 * Or:  cd Alice && npx vitest run tests/e2e/memory-bootstrap.test.ts --config tests/e2e/vitest.config.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import nock from "nock";
import { startTestServer, type TestServer } from "./helpers/server-factory";
import { postChat, type ChatResponse } from "./helpers/chat-client";
import { cleanNock } from "./helpers/nock-openviking";
import { makeChatInput } from "./helpers/fixtures";

const OV_BASE = "http://openviking-mock.test";

// ---------------------------------------------------------------------------
// Helper: build a search result with memories
// ---------------------------------------------------------------------------

const makeSearchResult = (memories: Array<{ uri: string; abstract: string; score?: number }> = []) => ({
  status: "ok",
  result: {
    memories: memories.map((m) => ({ ...m, score: m.score ?? 0.9 })),
    resources: [],
    skills: [],
    total: memories.length
  }
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Memory Bootstrap — Session Lifecycle (S-01, S-02, S-03, S-04)", () => {
  let srv: TestServer;

  beforeAll(async () => { srv = await startTestServer(); });
  afterAll(async () => { await srv.close(); });

  afterEach(() => { cleanNock(); });

  // -------------------------------------------------------------------------
  // S-01: First message creates a new OV session
  // -------------------------------------------------------------------------
  it("S-01: first chat creates OV session (new customer)", async () => {
    nock(OV_BASE).get("/api/v1/sessions").reply(200, { status: "ok", result: { sessions: [] } }).persist();
    nock(OV_BASE).post("/api/v1/sessions").reply(200, { status: "ok", result: { session_id: "ov_sess_new_001" } }).persist();
    nock(OV_BASE).post("/api/v1/search/search").reply(200, makeSearchResult()).persist();
    nock(OV_BASE).post("/api/v1/sessions/ov_sess_new_001/messages").reply(200, { status: "ok", result: { ok: true } }).persist();

    const { status, data } = await postChat(srv.baseUrl, makeChatInput({ text: "你们有什么新款跑鞋？" }));
    expect(status).toBe(200);
    expect(data.openVikingSessionId).toBe("ov_sess_new_001");
  });

  // -------------------------------------------------------------------------
  // S-02: Returning customer continues existing active session
  // -------------------------------------------------------------------------
  it("S-02: returning customer continues existing active session", async () => {
    nock(OV_BASE)
      .get("/api/v1/sessions")
      .reply(200, {
        status: "ok",
        result: {
          sessions: [{
            session_id: "ov_sess_existing_001",
            status: "active",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            message_count: 4
          }]
        }
      })
      .persist();
    nock(OV_BASE).post("/api/v1/search/search").reply(200, makeSearchResult()).persist();
    nock(OV_BASE).post("/api/v1/sessions/ov_sess_existing_001/messages").reply(200, { status: "ok", result: { ok: true } }).persist();

    const { status, data } = await postChat(srv.baseUrl, makeChatInput({ text: "上次你推荐的那双还有货吗？" }));
    expect(status).toBe(200);
    expect(data.openVikingSessionId).toBe("ov_sess_existing_001");
  });

  // -------------------------------------------------------------------------
  // S-03: Skips committed session, creates new one
  // -------------------------------------------------------------------------
  it("S-03: skips committed session and creates new session", async () => {
    nock(OV_BASE)
      .get("/api/v1/sessions")
      .reply(200, {
        status: "ok",
        result: {
          sessions: [{
            session_id: "old_sess_001",
            status: "committed",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            message_count: 25
          }]
        }
      })
      .persist();
    nock(OV_BASE).post("/api/v1/sessions").reply(200, { status: "ok", result: { session_id: "new_sess_001" } }).persist();
    nock(OV_BASE).post("/api/v1/search/search").reply(200, makeSearchResult()).persist();
    nock(OV_BASE).post("/api/v1/sessions/new_sess_001/messages").reply(200, { status: "ok", result: { ok: true } }).persist();

    const { status, data } = await postChat(srv.baseUrl, makeChatInput({ text: "你好，我想再看看跑鞋" }));
    expect(status).toBe(200);
    expect(data.openVikingSessionId).toBe("new_sess_001");
    expect(data.openVikingSessionId).not.toBe("old_sess_001");
  });

  // -------------------------------------------------------------------------
  // S-04: OV unreachable → degrades to local_ session
  // -------------------------------------------------------------------------
  it("S-04: OV unreachable → degrades to local_ session", async () => {
    // OV is completely unreachable — connection refused
    nock(OV_BASE).get("/api/v1/sessions").reply(500, { status: "error", message: "connection refused" }).persist();
    nock(OV_BASE).post("/api/v1/sessions").reply(500, { status: "error", message: "connection refused" }).persist();

    const { status, data } = await postChat(srv.baseUrl, makeChatInput({ text: "你们几点开始送货？" }));
    expect(status).toBe(200);
    expect(data.openVikingSessionId).toMatch(/^local_/);
    expect(data.reply).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Memory Loading Tests (M-01, M-02, M-03, M-04, M-05, M-06, M-07)
//
// Note: memoriesLoaded = shortTerm.recentMessages.length + categorized long-term.
// For a first message, recentMessages includes the current HumanMessage (length ≥ 1).
// ---------------------------------------------------------------------------

describe("Memory Bootstrap — Memory Loading (M-01 through M-07)", () => {
  let srv: TestServer;

  beforeAll(async () => { srv = await startTestServer(); });
  afterAll(async () => { await srv.close(); });

  afterEach(() => { cleanNock(); });

  // -------------------------------------------------------------------------
  // M-01: Normal message triggers search call
  // -------------------------------------------------------------------------
  it("M-01: normal message triggers search call", async () => {
    const searchScope = nock(OV_BASE)
      .post("/api/v1/search/search")
      .reply(200, makeSearchResult([]))
      .persist();

    nock(OV_BASE).get("/api/v1/sessions").reply(200, { status: "ok", result: { sessions: [] } }).persist();
    nock(OV_BASE).post("/api/v1/sessions").reply(200, { status: "ok", result: { session_id: "ov_sess_001" } }).persist();
    nock(OV_BASE).post(/\/api\/v1\/sessions\/.*\/messages/).reply(200, { status: "ok", result: { ok: true } }).persist();

    const { status } = await postChat(srv.baseUrl, makeChatInput({ text: "有没有适合我的跑鞋？" }));
    expect(status).toBe(200);
    expect(searchScope.isDone()).toBe(true);
  });

  // -------------------------------------------------------------------------
  // M-03: Pure image message (text=placeholder) → still makes search call
  // Note: text="" fails app.ts validation, so we use "[media]" placeholder
  // -------------------------------------------------------------------------
  it("M-03: pure image message still loads memories", async () => {
    const searchScope = nock(OV_BASE)
      .post("/api/v1/search/search")
      .reply(200, makeSearchResult([]))
      .persist();

    nock(OV_BASE).get("/api/v1/sessions").reply(200, { status: "ok", result: { sessions: [] } }).persist();
    nock(OV_BASE).post("/api/v1/sessions").reply(200, { status: "ok", result: { session_id: "ov_sess_001" } }).persist();
    nock(OV_BASE).post(/\/api\/v1\/sessions\/.*\/messages/).reply(200, { status: "ok", result: { ok: true } }).persist();

    // Use "[media]" as text placeholder (app requires text to be non-empty)
    const { status } = await postChat(srv.baseUrl, makeChatInput({
      text: "[media]",
      media: { mediaId: "img_001", mediaType: "image", base64Data: "dGVzdA==", mimeType: "image/jpeg" }
    }));
    expect(status).toBe(200);
    expect(searchScope.isDone()).toBe(true);
  });

  // -------------------------------------------------------------------------
  // M-05: search fails → falls back to findMemories
  // -------------------------------------------------------------------------
  it("M-05: search fails → falls back to findMemories", async () => {
    const searchScope = nock(OV_BASE)
      .post("/api/v1/search/search")
      .reply(500, { status: "error", message: "internal error" })
      .persist();
    const findScope = nock(OV_BASE)
      .post("/api/v1/search/find")
      .reply(200, makeSearchResult([
        { uri: "viking://user/memories/preference/size_42", abstract: "prefers size 42" }
      ]))
      .persist();

    nock(OV_BASE).get("/api/v1/sessions").reply(200, { status: "ok", result: { sessions: [] } }).persist();
    nock(OV_BASE).post("/api/v1/sessions").reply(200, { status: "ok", result: { session_id: "ov_sess_001" } }).persist();
    nock(OV_BASE).post(/\/api\/v1\/sessions\/.*\/messages/).reply(200, { status: "ok", result: { ok: true } }).persist();

    // Use "你好" → routes to general_chat (chat_agent, no search call)
    const { status, data } = await postChat(srv.baseUrl, makeChatInput({ text: "你好" }));
    expect(status).toBe(200);
    expect(searchScope.isDone()).toBe(true);
    expect(findScope.isDone()).toBe(true);
    // memoriesLoaded = 1 (recentMessages) + 1 (preference) = 2
    expect(data.memoriesLoaded).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // M-06: Both search and findMemories fail → returns with 0 long-term memories
  // -------------------------------------------------------------------------
  it("M-06: both search and findMemories fail → degrades gracefully", async () => {
    nock(OV_BASE).post("/api/v1/search/search").reply(500, { status: "error" }).persist();
    nock(OV_BASE).post("/api/v1/search/find").reply(500, { status: "error" }).persist();
    nock(OV_BASE).get("/api/v1/sessions").reply(200, { status: "ok", result: { sessions: [] } }).persist();
    nock(OV_BASE).post("/api/v1/sessions").reply(200, { status: "ok", result: { session_id: "ov_sess_001" } }).persist();
    nock(OV_BASE).post(/\/api\/v1\/sessions\/.*\/messages/).reply(200, { status: "ok", result: { ok: true } }).persist();

    // "你好" → general_chat (no domain agent search calls)
    const { status, data } = await postChat(srv.baseUrl, makeChatInput({ text: "你好" }));
    expect(status).toBe(200);
    // memoriesLoaded = 1 (recentMessages, current message) + 0 (longTerm) = 1
    expect(data.memoriesLoaded).toBeGreaterThanOrEqual(1);
    expect(data.reply).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // M-07: Large number of memories — system handles gracefully
  // -------------------------------------------------------------------------
  it("M-07: loads many memories without crashing", async () => {
    const manyMemories = Array.from({ length: 50 }, (_, i) => ({
      uri: `viking://user/memories/preference/item_${i}`,
      abstract: `Preference ${i}`,
      score: 0.9
    }));

    nock(OV_BASE)
      .get("/api/v1/sessions")
      .reply(200, { status: "ok", result: { sessions: [] } })
      .persist();
    nock(OV_BASE)
      .post("/api/v1/sessions")
      .reply(200, { status: "ok", result: { session_id: "ov_sess_001" } })
      .persist();
    nock(OV_BASE)
      .post("/api/v1/search/search")
      .reply(200, makeSearchResult(manyMemories))
      .persist();
    nock(OV_BASE)
      .post(/\/api\/v1\/sessions\/.*\/messages/)
      .reply(200, { status: "ok", result: { ok: true } })
      .persist();

    const { status, data } = await postChat(srv.baseUrl, makeChatInput({ text: "查看我的所有偏好" }));
    expect(status).toBe(200);
    // 50 preference items → preferences = 50
    // memoriesLoaded = 1 (recent) + 50 (preferences) = 51
    expect(data.memoriesLoaded).toBeGreaterThan(50);
    expect(data.reply).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Memory Categorization Tests (C-01 through C-07)
//
// memoriesLoaded = shortTerm.recentMessages.length + longTerm categorized count.
// recentMessages always includes at least the current message (1).
// ---------------------------------------------------------------------------

describe("Memory Bootstrap — Memory Categorization (C-01 through C-07)", () => {
  let srv: TestServer;

  beforeAll(async () => { srv = await startTestServer(); });
  afterAll(async () => { await srv.close(); });

  afterEach(() => { cleanNock(); });

  // C-01: profile memory detected (1 profile + 1 recent = 2)
  it("C-01: profile memory is loaded", async () => {
    nock(OV_BASE)
      .post("/api/v1/search/search")
      .reply(200, makeSearchResult([
        { uri: "viking://user/memories/profile/001", abstract: "28岁男性，运动爱好者" }
      ]))
      .persist();
    nock(OV_BASE).get("/api/v1/sessions").reply(200, { status: "ok", result: { sessions: [] } }).persist();
    nock(OV_BASE).post("/api/v1/sessions").reply(200, { status: "ok", result: { session_id: "ov_sess_001" } }).persist();
    nock(OV_BASE).post(/\/api\/v1\/sessions\/.*\/messages/).reply(200, { status: "ok", result: { ok: true } }).persist();

    const { status, data } = await postChat(srv.baseUrl, makeChatInput({ text: "你好" }));
    expect(status).toBe(200);
    // memoriesLoaded = 1 (recent) + 1 (profile) = 2
    expect(data.memoriesLoaded).toBe(2);
  });

  // C-02: case memory goes to preferences (no /cases/ bucket exists)
  // 1 preference + 1 recent = 2
  it("C-02: case memory is categorized (goes to preferences — no cases bucket)", async () => {
    nock(OV_BASE)
      .post("/api/v1/search/search")
      .reply(200, makeSearchResult([
        { uri: "viking://user/memories/cases/001", abstract: "purchased Nike Air Max, satisfied" }
      ]))
      .persist();
    nock(OV_BASE).get("/api/v1/sessions").reply(200, { status: "ok", result: { sessions: [] } }).persist();
    nock(OV_BASE).post("/api/v1/sessions").reply(200, { status: "ok", result: { session_id: "ov_sess_001" } }).persist();
    nock(OV_BASE).post(/\/api\/v1\/sessions\/.*\/messages/).reply(200, { status: "ok", result: { ok: true } }).persist();

    const { status, data } = await postChat(srv.baseUrl, makeChatInput({ text: "上次买的鞋怎么样" }));
    expect(status).toBe(200);
    // memoriesLoaded = 1 (recent) + 1 (preference, /cases/ falls to else) = 2
    expect(data.memoriesLoaded).toBe(2);
  });

  // C-03: pattern memory goes to events (mapped from /patterns/)
  // 1 pattern (as event) + 1 recent = 2
  it("C-03: pattern memory is categorized (goes to events)", async () => {
    nock(OV_BASE)
      .post("/api/v1/search/search")
      .reply(200, makeSearchResult([
        { uri: "viking://user/memories/patterns/spending_habit", abstract: "frequently purchases in first week of month" }
      ]))
      .persist();
    nock(OV_BASE).get("/api/v1/sessions").reply(200, { status: "ok", result: { sessions: [] } }).persist();
    nock(OV_BASE).post("/api/v1/sessions").reply(200, { status: "ok", result: { session_id: "ov_sess_001" } }).persist();
    nock(OV_BASE).post(/\/api\/v1\/sessions\/.*\/messages/).reply(200, { status: "ok", result: { ok: true } }).persist();

    const { status, data } = await postChat(srv.baseUrl, makeChatInput({ text: "有什么新优惠吗" }));
    expect(status).toBe(200);
    // memoriesLoaded = 1 (recent) + 1 (event, /patterns/ → events) = 2
    expect(data.memoriesLoaded).toBe(2);
  });

  // C-04/C-04b: event/milestone memories → events bucket
  // 2 events + 1 recent = 3
  it("C-04/C-04b: event and milestone memories go to events bucket", async () => {
    nock(OV_BASE)
      .post("/api/v1/search/search")
      .reply(200, makeSearchResult([
        { uri: "viking://user/memories/events/order_123", abstract: "下单了 Nike Air Max" },
        { uri: "viking://user/memories/milestone/first_purchase", abstract: "完成了首次购买" }
      ]))
      .persist();
    nock(OV_BASE).get("/api/v1/sessions").reply(200, { status: "ok", result: { sessions: [] } }).persist();
    nock(OV_BASE).post("/api/v1/sessions").reply(200, { status: "ok", result: { session_id: "ov_sess_001" } }).persist();
    nock(OV_BASE).post(/\/api\/v1\/sessions\/.*\/messages/).reply(200, { status: "ok", result: { ok: true } }).persist();

    const { status, data } = await postChat(srv.baseUrl, makeChatInput({ text: "查看订单状态" }));
    expect(status).toBe(200);
    // memoriesLoaded = 1 (recent) + 2 (events, /event/ and /milestone/) = 3
    expect(data.memoriesLoaded).toBe(3);
  });

  // C-05: preference memory → preferences bucket
  // 1 preference + 1 recent = 2
  it("C-05: preference memory is categorized correctly", async () => {
    nock(OV_BASE)
      .post("/api/v1/search/search")
      .reply(200, makeSearchResult([
        { uri: "viking://user/memories/preference/size", abstract: "prefers size 42 wide toe box" }
      ]))
      .persist();
    nock(OV_BASE).get("/api/v1/sessions").reply(200, { status: "ok", result: { sessions: [] } }).persist();
    nock(OV_BASE).post("/api/v1/sessions").reply(200, { status: "ok", result: { session_id: "ov_sess_001" } }).persist();
    nock(OV_BASE).post(/\/api\/v1\/sessions\/.*\/messages/).reply(200, { status: "ok", result: { ok: true } }).persist();

    const { status, data } = await postChat(srv.baseUrl, makeChatInput({ text: "推荐一双鞋" }));
    expect(status).toBe(200);
    // memoriesLoaded = 1 (recent) + 1 (preference) = 2
    expect(data.memoriesLoaded).toBe(2);
  });

  // C-06: unknown type → falls to else → preferences
  // 1 preference + 1 recent = 2
  it("C-06: unknown memory type is categorized as preference", async () => {
    nock(OV_BASE)
      .post("/api/v1/search/search")
      .reply(200, makeSearchResult([
        { uri: "viking://user/memories/other/unknown_type", abstract: "some unknown data" }
      ]))
      .persist();
    nock(OV_BASE).get("/api/v1/sessions").reply(200, { status: "ok", result: { sessions: [] } }).persist();
    nock(OV_BASE).post("/api/v1/sessions").reply(200, { status: "ok", result: { session_id: "ov_sess_001" } }).persist();
    nock(OV_BASE).post(/\/api\/v1\/sessions\/.*\/messages/).reply(200, { status: "ok", result: { ok: true } }).persist();

    const { status, data } = await postChat(srv.baseUrl, makeChatInput({ text: "你好" }));
    expect(status).toBe(200);
    // memoriesLoaded = 1 (recent) + 1 (preference, unknown → else) = 2
    expect(data.memoriesLoaded).toBe(2);
  });

  // C-07: mixed categories
  // /profile/001 → profile (1), /cases/001 → else → preferences (1)
  // /patterns/spending → events (1), /events/order_123 → events (1)
  // Total longTerm = 1 + 1 + 1 + 1 = 4, + 1 recent = 5
  it("C-07: mixed memory categories are all loaded", async () => {
    nock(OV_BASE)
      .post("/api/v1/search/search")
      .reply(200, makeSearchResult([
        { uri: "viking://user/memories/profile/001", abstract: "VIP customer" },
        { uri: "viking://user/memories/cases/001", abstract: "purchased Nike Air Max" },
        { uri: "viking://user/memories/patterns/spending", abstract: "monthly buyer" },
        { uri: "viking://user/memories/events/order_123", abstract: "order placed" }
      ]))
      .persist();
    nock(OV_BASE).get("/api/v1/sessions").reply(200, { status: "ok", result: { sessions: [] } }).persist();
    nock(OV_BASE).post("/api/v1/sessions").reply(200, { status: "ok", result: { session_id: "ov_sess_001" } }).persist();
    nock(OV_BASE).post(/\/api\/v1\/sessions\/.*\/messages/).reply(200, { status: "ok", result: { ok: true } }).persist();

    const { status, data } = await postChat(srv.baseUrl, makeChatInput({ text: "我是老客户了" }));
    expect(status).toBe(200);
    // memoriesLoaded = 1 (recent) + 4 (mixed longTerm) = 5
    expect(data.memoriesLoaded).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Session Persistence Tests (P-01, P-05, P-06, P-07)
// ---------------------------------------------------------------------------

describe("Memory Persist — Message Persistence (P-01, P-05, P-06, P-07)", () => {
  let srv: TestServer;

  beforeAll(async () => { srv = await startTestServer(); });
  afterAll(async () => { await srv.close(); });

  afterEach(() => { cleanNock(); });

  // P-01: Normal conversation → user + assistant messages both persisted
  it("P-01: user and assistant messages are both persisted", async () => {
    nock(OV_BASE).get("/api/v1/sessions").reply(200, { status: "ok", result: { sessions: [] } }).persist();
    nock(OV_BASE).post("/api/v1/sessions").reply(200, { status: "ok", result: { session_id: "ov_sess_001" } }).persist();
    nock(OV_BASE).post("/api/v1/search/search").reply(200, makeSearchResult([])).persist();
    nock(OV_BASE).post("/api/v1/sessions/ov_sess_001/used").reply(200, { status: "ok", result: { ok: true } }).persist();
    nock(OV_BASE).post("/api/v1/sessions/ov_sess_001/messages").reply(200, { status: "ok", result: { ok: true } }).persist();

    const { status, data } = await postChat(srv.baseUrl, makeChatInput({ text: "你们有什么新款？" }));
    expect(status).toBe(200);
    expect(data.trace.some((t: string) => t.includes("persist=ok"))).toBe(true);
  });

  // P-05: addMessage fails → conversation continues normally
  it("P-05: addMessage failure does not interrupt response", async () => {
    nock(OV_BASE).get("/api/v1/sessions").reply(200, { status: "ok", result: { sessions: [] } }).persist();
    nock(OV_BASE).post("/api/v1/sessions").reply(200, { status: "ok", result: { session_id: "ov_sess_001" } }).persist();
    nock(OV_BASE).post("/api/v1/search/search").reply(200, makeSearchResult([])).persist();
    // addMessage fails
    nock(OV_BASE).post("/api/v1/sessions/ov_sess_001/messages").reply(500, { status: "error" }).persist();

    const { status, data } = await postChat(srv.baseUrl, makeChatInput({ text: "你好" }));
    expect(status).toBe(200);
    expect(data.reply).toBeTruthy();
    expect(data.trace.some((t: string) => t.includes("persist=error"))).toBe(true);
  });

  // P-06: sessionUsed failure → conversation continues normally
  it("P-06: sessionUsed failure does not interrupt response", async () => {
    nock(OV_BASE).get("/api/v1/sessions").reply(200, { status: "ok", result: { sessions: [] } }).persist();
    nock(OV_BASE).post("/api/v1/sessions").reply(200, { status: "ok", result: { session_id: "ov_sess_001" } }).persist();
    nock(OV_BASE).post("/api/v1/search/search").reply(200, makeSearchResult([
      { uri: "viking://resources/products/nike-990", abstract: "Nike Air Max 990" }
    ])).persist();
    nock(OV_BASE).post("/api/v1/sessions/ov_sess_001/messages").reply(200, { status: "ok", result: { ok: true } }).persist();
    // sessionUsed fails
    nock(OV_BASE).post("/api/v1/sessions/ov_sess_001/used").reply(500, { status: "error" }).persist();

    const { status, data } = await postChat(srv.baseUrl, makeChatInput({ text: "推荐一双鞋" }));
    expect(status).toBe(200);
    expect(data.reply).toBeTruthy();
    expect(data.trace.some((t: string) => t.includes("persist=ok"))).toBe(true);
  });

  // P-07: local_ session → persist is skipped entirely
  it("P-07: local_ session skips all OV persist calls", async () => {
    nock(OV_BASE).get("/api/v1/sessions").reply(500, { status: "error" }).persist();
    nock(OV_BASE).post("/api/v1/sessions").reply(500, { status: "error" }).persist();

    const { status, data } = await postChat(srv.baseUrl, makeChatInput({ text: "你好" }));
    expect(status).toBe(200);
    expect(data.openVikingSessionId).toMatch(/^local_/);
    expect(data.trace.some((t: string) => t.includes("persist=skipped"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Session Recovery Tests (R-01, R-02, R-03)
// ---------------------------------------------------------------------------

describe("Session Recovery Detection (R-01, R-02, R-03)", () => {
  let srv: TestServer;

  beforeAll(async () => { srv = await startTestServer(); });
  afterAll(async () => { await srv.close(); });

  afterEach(() => { cleanNock(); });

  // R-01: Redis lost → OV has existing session with message_count > 0 → recovery
  it("R-01: Redis lost + OV has history → recovery scenario detected", async () => {
    // No Alice session passed (simulating Redis loss: new sessionId)
    nock(OV_BASE)
      .get("/api/v1/sessions")
      .reply(200, {
        status: "ok",
        result: {
          sessions: [{
            session_id: "ov_sess_recovery_001",
            status: "active",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            message_count: 15
          }]
        }
      })
      .persist();
    nock(OV_BASE).post("/api/v1/search/search").reply(200, makeSearchResult([])).persist();
    nock(OV_BASE).post(/\/api\/v1\/sessions\/.*\/messages/).reply(200, { status: "ok", result: { ok: true } }).persist();

    const { status, data } = await postChat(srv.baseUrl, makeChatInput({ text: "继续上次的话题" }));
    expect(status).toBe(200);
    expect(data.openVikingSessionId).toBe("ov_sess_recovery_001");
    expect(data.trace.some((t: string) => t.includes("recovery"))).toBe(true);
  });

  // R-02: New customer → no OV history → NOT recovery
  it("R-02: new customer → recovery NOT triggered", async () => {
    nock(OV_BASE).get("/api/v1/sessions").reply(200, { status: "ok", result: { sessions: [] } }).persist();
    nock(OV_BASE).post("/api/v1/sessions").reply(200, { status: "ok", result: { session_id: "ov_sess_new_001" } }).persist();
    nock(OV_BASE).post("/api/v1/search/search").reply(200, makeSearchResult([])).persist();
    nock(OV_BASE).post(/\/api\/v1\/sessions\/.*\/messages/).reply(200, { status: "ok", result: { ok: true } }).persist();

    const { status, data } = await postChat(srv.baseUrl, makeChatInput({ text: "你好，我是新客户" }));
    expect(status).toBe(200);
    expect(data.trace.some((t: string) => t.includes("recovery"))).toBe(false);
  });

  // R-03: Normal continuation → NOT recovery
  it("R-03: normal session continuation → recovery NOT triggered", async () => {
    const existingSessionId = "ov_sess_normal_001";

    nock(OV_BASE)
      .get("/api/v1/sessions")
      .reply(200, {
        status: "ok",
        result: {
          sessions: [{
            session_id: existingSessionId,
            status: "active",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            message_count: 3
          }]
        }
      })
      .persist();
    nock(OV_BASE).post("/api/v1/search/search").reply(200, makeSearchResult([])).persist();
    nock(OV_BASE).post(/\/api\/v1\/sessions\/.*\/messages/).reply(200, { status: "ok", result: { ok: true } }).persist();

    // Pass the existing sessionId → normal continuation
    const { status, data } = await postChat(srv.baseUrl, makeChatInput({
      sessionId: "existing_alice_session_001",
      text: "继续"
    }));
    expect(status).toBe(200);
    expect(data.openVikingSessionId).toBe(existingSessionId);
    expect(data.trace.some((t: string) => t.includes("recovery"))).toBe(false);
  });
});
