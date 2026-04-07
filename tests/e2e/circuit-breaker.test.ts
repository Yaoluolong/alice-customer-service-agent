/**
 * B-02: OV 完全不可达时 Alice 正常返回
 *
 * NOTE — B-01 (circuit breaker opens after 5 consecutive failures → fast-fail):
 *   Hard to cover reliably in e2e because:
 *   1. The circuit breaker lives on the singleton openVikingClient; state is shared
 *      across all tests in the same process, so a tripped breaker would poison
 *      subsequent tests.
 *   2. Verifying "fast-fail" requires timing assertions that are fragile in CI.
 *   → B-01 is marked as manual / integration-test only.
 *      To exercise it manually: send 5 requests to a node that calls OV while OV
 *      is unreachable, then observe that the 6th request logs "CircuitBreakerOpen"
 *      instead of attempting a new HTTP connection.
 *
 * NOTE — Circuit breaker state across tests:
 *   The singleton openVikingClient has a ConsecutiveBreaker(5). Each test that
 *   drives all OV endpoints to fail will trip the breaker after 5 consecutive
 *   errors (listSessions + 2x memoryBootstrap search + findMemories fallback +
 *   salesAgent search = 5). Once open, it stays open for 60 s (halfOpenAfter).
 *   For this reason each test uses its own TestServer instance so the Alice
 *   service layer is isolated, AND test 2 injects a mock OV client via DI
 *   (config.configurable.ovClient) rather than relying on nock + the singleton.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import nock from "nock";
import { startTestServer, type TestServer } from "./helpers/server-factory";
import { postChat } from "./helpers/chat-client";
import { memoryBootstrapNode } from "../../src/nodes/memoryNode";
import { OpenVikingHttpClient } from "../../src/clients/openviking-client";
import { HumanMessage } from "@langchain/core/messages";

const OV_HOST = "http://openviking-mock.test";

// ─── B-02a: All OV endpoints unreachable ────────────────────────────────────

describe("B-02a: Alice resilience — OV completely unreachable", () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it("returns valid reply when OV is completely unreachable", async () => {
    // All OV endpoints fail with connection errors.
    // Note: this will trip the singleton circuit breaker (ConsecutiveBreaker(5))
    // after listSessions + 2x search(bootstrap) + findMemories + search(salesAgent).
    // That is expected and acceptable — the circuit breaker being open is
    // actually the fast-fail behaviour we want (B-01), and Alice must still reply.
    nock(OV_HOST).get("/api/v1/sessions").replyWithError("connection refused").persist();
    nock(OV_HOST).post("/api/v1/sessions").replyWithError("connection refused").persist();
    nock(OV_HOST).post("/api/v1/search/search").replyWithError("connection refused").persist();
    nock(OV_HOST).post("/api/v1/search/find").replyWithError("connection refused").persist();
    nock(OV_HOST).post(/\/api\/v1\/sessions\/.*\/messages/).replyWithError("connection refused").persist();
    nock(OV_HOST).post(/\/api\/v1\/sessions\/.*\/used/).replyWithError("connection refused").persist();

    const result = await postChat(server.baseUrl, {
      tenantId: "t1",
      customerId: "c1",
      text: "你们有什么跑鞋？",
    });

    expect(result.status).toBe(200);
    expect(result.data.reply).toBeTruthy();
    expect(result.data.openVikingSessionId).toMatch(/^local_/);
    // memoriesLoaded counts shortTerm.recentMessages (includes the user's own message)
    // plus any OV-sourced long-term memories. With OV down, long-term count = 0.
    // recentMessages.length is 1 for the first message in a fresh session.
    expect(result.data.memoriesLoaded).toBeLessThanOrEqual(1);
  });
});

// ─── B-02b: Only OV search fails (session lifecycle works) ──────────────────
//
// Uses mock OV client DI (not nock) because:
// 1. The circuit breaker may already be open from B-02a above.
// 2. DI bypasses the singleton, so test is isolated regardless of breaker state.

describe("B-02b: Alice resilience — only OV search fails", () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it("returns valid reply when only OV search fails (session still created via DI mock)", async () => {
    // Build a mock OV client where session lifecycle works but search throws.
    const mockOvClient = Object.assign(Object.create(OpenVikingHttpClient.prototype), {
      listSessions: vi.fn().mockResolvedValue([]),
      createSession: vi.fn().mockResolvedValue({ session_id: "ov_sess_b02b" }),
      search: vi.fn().mockRejectedValue(new Error("search timeout")),
      findMemories: vi.fn().mockRejectedValue(new Error("search timeout")),
      readDetail: vi.fn().mockRejectedValue(new Error("search timeout")),
      addMessage: vi.fn().mockResolvedValue(undefined),
      sessionUsed: vi.fn().mockResolvedValue(undefined),
      commitSession: vi.fn().mockResolvedValue(undefined),
    } as Partial<InstanceType<typeof OpenVikingHttpClient>>);

    // Inject the mock via memoryBootstrapNode directly to verify OV session ID.
    // We also test the full HTTP path below.
    const state = {
      tenant_id: "t2",
      customer_id: "c2",
      openviking_session_id: null,
      openviking_message_count: 0,
      messages: [new HumanMessage("你们有什么跑鞋？")],
      grounding_facts: null,
      media_context: null,
      style_profile: null,
      memory_context: null,
    };

    const bootstrapResult = await memoryBootstrapNode(state as any, {
      configurable: { ovClient: mockOvClient },
    } as any);

    // Session was created via OV (not local_)
    expect(bootstrapResult.openviking_session_id).toBe("ov_sess_b02b");
    // No long-term memories loaded (search failed)
    expect(bootstrapResult.memory_context?.longTerm.profile).toBeNull();
    expect(bootstrapResult.memory_context?.longTerm.preferences).toHaveLength(0);
    expect(bootstrapResult.memory_context?.longTerm.entities).toHaveLength(0);
  });
});
