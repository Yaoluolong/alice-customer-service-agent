import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import nock from "nock";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { startTestServer, type TestServer } from "./helpers/server-factory";
import { postChat, getSession } from "./helpers/chat-client";
import { mockOpenVikingAll, cleanNock } from "./helpers/nock-openviking";
import { greetingInput, makeChatInput } from "./helpers/fixtures";
import { memoryPersistNode } from "../../src/nodes/memoryNode";
import { OpenVikingHttpClient } from "../../src/clients/openviking-client";

const OV_BASE = "http://openviking-mock.test";

describe("Session lifecycle", () => {
  let srv: TestServer;

  beforeAll(async () => {
    srv = await startTestServer();
  });

  afterAll(async () => {
    await srv.close();
  });

  beforeEach(() => {
    mockOpenVikingAll();
  });

  afterEach(() => {
    cleanNock();
  });

  it("first chat creates a new session and returns sessionId", async () => {
    const { status, data } = await postChat(srv.baseUrl, greetingInput());
    expect(status).toBe(200);
    expect(typeof data.sessionId).toBe("string");
    expect(data.sessionId.length).toBeGreaterThan(0);
  });

  it("second chat with same sessionId continues the session", async () => {
    const first = await postChat(srv.baseUrl, greetingInput());
    const sessionId = first.data.sessionId;

    const second = await postChat(srv.baseUrl, makeChatInput({
      sessionId,
      text: "商品库存怎么样"
    }));

    expect(second.status).toBe(200);
    expect(second.data.sessionId).toBe(sessionId);
  });

  it("GET /v1/sessions/:id returns an existing session", async () => {
    const { data: chatData } = await postChat(srv.baseUrl, greetingInput());
    const { status, data } = await getSession(srv.baseUrl, chatData.sessionId);
    expect(status).toBe(200);
    expect(data).toBeTruthy();
  });

  it("GET /v1/sessions/:id returns 404 for nonexistent session", async () => {
    const { status } = await getSession(srv.baseUrl, "session_does_not_exist_xyz");
    expect(status).toBe(404);
  });

  // S-03: committed session is skipped; a new OV session is created
  it("S-03: skips committed session and creates a new OV session", async () => {
    // Override the default nock set by beforeEach (cleanNock + re-mock)
    cleanNock();

    // listSessions returns one committed session
    nock(OV_BASE)
      .get("/api/v1/sessions")
      .reply(200, {
        result: {
          sessions: [{
            session_id: "old_sess",
            status: "committed",
            created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
            updated_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
            message_count: 5
          }]
        }
      })
      .persist();

    // createSession returns a fresh session
    nock(OV_BASE)
      .post("/api/v1/sessions")
      .reply(200, { result: { session_id: "ov_sess_new" } })
      .persist();

    // Remaining OV endpoints
    nock(OV_BASE)
      .post("/api/v1/search/find")
      .reply(200, { result: { memories: [], resources: [], skills: [], total: 0 } })
      .persist();

    nock(OV_BASE)
      .post("/api/v1/search/search")
      .reply(200, { result: { memories: [], resources: [], skills: [], total: 0 } })
      .persist();

    nock(OV_BASE)
      .post(/\/api\/v1\/sessions\/.*\/used/)
      .reply(200, { result: { ok: true } })
      .persist();

    nock(OV_BASE)
      .post(/\/api\/v1\/sessions\/.*\/messages/)
      .reply(200, { result: { ok: true } })
      .persist();

    nock(OV_BASE)
      .post(/\/api\/v1\/sessions\/.*\/commit/)
      .reply(200, { result: { ok: true } })
      .persist();

    const { status, data } = await postChat(srv.baseUrl, greetingInput());

    expect(status).toBe(200);
    expect(data.openVikingSessionId).toBeTruthy();
    expect(data.openVikingSessionId).not.toBe("old_sess");
    expect(data.reply).toBeTruthy();
  });

  // S-04: OV unreachable → Alice falls back to local_ session and still responds
  it("S-04: OV unreachable → degrades to local_ session, still replies", async () => {
    cleanNock();

    // All OV endpoints return network errors
    nock(OV_BASE)
      .get("/api/v1/sessions")
      .replyWithError("connection refused")
      .persist();

    nock(OV_BASE)
      .post("/api/v1/sessions")
      .replyWithError("connection refused")
      .persist();

    nock(OV_BASE)
      .post("/api/v1/search/search")
      .replyWithError("connection refused")
      .persist();

    nock(OV_BASE)
      .post("/api/v1/search/find")
      .replyWithError("connection refused")
      .persist();

    nock(OV_BASE)
      .post(/\/api\/v1\/sessions\/.*\/messages/)
      .replyWithError("connection refused")
      .persist();

    nock(OV_BASE)
      .post(/\/api\/v1\/sessions\/.*\/used/)
      .replyWithError("connection refused")
      .persist();

    nock(OV_BASE)
      .post(/\/api\/v1\/sessions\/.*\/commit/)
      .replyWithError("connection refused")
      .persist();

    const { status, data } = await postChat(srv.baseUrl, greetingInput());

    expect(status).toBe(200);
    expect(data.reply).toBeTruthy();
    expect(typeof data.openVikingSessionId).toBe("string");
    expect(data.openVikingSessionId).toMatch(/^local_/);
  });
});

// S-05: message count reaching 20 triggers commitSession (unit-level, mock OV client via DI)
describe("S-05: memoryPersistNode triggers commit at message count 20", () => {
  it("calls commitSession and resets session state when count reaches threshold", async () => {
    const addMessage = vi.fn().mockResolvedValue(undefined);
    const commitSession = vi.fn().mockResolvedValue(undefined);
    const sessionUsed = vi.fn().mockResolvedValue(undefined);

    const mockOvClient = Object.assign(Object.create(OpenVikingHttpClient.prototype), {
      addMessage,
      commitSession,
      sessionUsed,
    });

    const state = {
      tenant_id: "tenant_test_001",
      customer_id: "cust_test_001",
      openviking_session_id: "ov_sess_commit",
      openviking_message_count: 18,
      messages: [new HumanMessage("hi"), new AIMessage("hello")],
      grounding_facts: null,
      media_context: null,
      style_profile: null,
    };

    const config = {
      configurable: {
        ovClient: mockOvClient,
      },
    };

    const result = await memoryPersistNode(state as any, config as any);

    // commitSession should have been called with the session ID
    expect(commitSession).toHaveBeenCalledWith(
      "tenant_test_001",
      "cust_test_001",
      "ov_sess_commit",
      false
    );

    // Session should be reset for next conversation
    expect(result.openviking_session_id).toBeNull();
    expect(result.openviking_message_count).toBe(0);

    // Trace should record the commit threshold
    expect(result.trace).toBeDefined();
    expect(result.trace!.some((t: string) => t.includes("commit@20"))).toBe(true);
  });
});
