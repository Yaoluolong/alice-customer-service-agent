import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { startTestServer, type TestServer } from "./helpers/server-factory";
import { postChat } from "./helpers/chat-client";
import { mockOpenVikingAll, cleanNock } from "./helpers/nock-openviking";
import { mediaInput, imageContextInput } from "./helpers/fixtures";

describe("Media message routing", () => {
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

  it("message with media context routes through visual_agent", async () => {
    const { status, data } = await postChat(srv.baseUrl, mediaInput());
    expect(status).toBe(200);
    // visualAgentNode sets user_intent=PRODUCT_INQUIRY (by design), route_target stays VISUAL_AGENT
    expect(data.route).toBe("visual_agent");
    expect(data.trace.some((t: string) => t.startsWith("visual:"))).toBe(true);
  });

  it("message with legacy image context also routes through visual_agent", async () => {
    const { status, data } = await postChat(srv.baseUrl, imageContextInput());
    expect(status).toBe(200);
    expect(data.route).toBe("visual_agent");
    expect(data.trace.some((t: string) => t.startsWith("visual:"))).toBe(true);
  });
});
