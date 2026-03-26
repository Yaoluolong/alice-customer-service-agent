import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { startTestServer, type TestServer } from "./helpers/server-factory";
import { postChat, getSession } from "./helpers/chat-client";
import { mockOpenVikingAll, cleanNock } from "./helpers/nock-openviking";
import { greetingInput, makeChatInput } from "./helpers/fixtures";

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
});
