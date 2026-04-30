import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { startTestServer, type TestServer } from "./helpers/server-factory";
import { postChat } from "./helpers/chat-client";
import { mockOpenVikingAll, cleanNock } from "./helpers/nock-openviking";
import {
  greetingInput,
  productInquiryInput,
  orderStatusInput,
  mediaInput,
  makeChatInput
} from "./helpers/fixtures";

describe("Chat routing (heuristic, no LLM)", () => {
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

  it("'你好' routes to general_chat / chat_agent", async () => {
    const { status, data } = await postChat(srv.baseUrl, greetingInput());
    expect(status).toBe(200);
    expect(data.intent).toBe("general_chat");
    expect(data.route).toBe("chat_agent");
  });

  it("product inquiry routes to product_inquiry / sales_agent", async () => {
    const { status, data } = await postChat(srv.baseUrl, productInquiryInput());
    expect(status).toBe(200);
    expect(data.intent).toBe("product_inquiry");
    expect(data.route).toBe("sales_agent");
  });

  it("order status query routes to order_status / order_agent", async () => {
    const { status, data } = await postChat(srv.baseUrl, orderStatusInput());
    expect(status).toBe(200);
    expect(data.intent).toBe("order_status");
    expect(data.route).toBe("order_agent");
  });

  it("message with media routes through visual_agent (route=visual_agent)", async () => {
    const { status, data } = await postChat(srv.baseUrl, mediaInput());
    expect(status).toBe(200);
    // visualAgentNode overwrites user_intent to PRODUCT_INQUIRY by design (visual→product)
    // but route_target stays VISUAL_AGENT (set by router, never changed)
    expect(data.route).toBe("visual_agent");
    // Trace should contain a visual step
    expect(data.trace.some((t: string) => t.startsWith("visual:"))).toBe(true);
  });

  it("unclassifiable text routes to chat_agent (not human_handoff)", async () => {
    const { status, data } = await postChat(srv.baseUrl, makeChatInput({ text: "xyzzy_completely_unknown_intent_zxcvb" }));
    expect(status).toBe(200);
    // UNKNOWN intent must fall back to chatAgent, never directly to human_handoff at router level
    expect(data.route).toBe("chat_agent");
    expect(data.intent).toBe("unknown");
  });

  it("all responses include non-empty trace array", async () => {
    const { status, data } = await postChat(srv.baseUrl, greetingInput());
    expect(status).toBe(200);
    expect(Array.isArray(data.trace)).toBe(true);
    expect(data.trace.length).toBeGreaterThan(0);
  });
});
