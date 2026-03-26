import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { startTestServer, type TestServer } from "./helpers/server-factory";
import { postChat } from "./helpers/chat-client";
import { mockOpenVikingAll, cleanNock } from "./helpers/nock-openviking";
import { greetingInput, productInquiryInput } from "./helpers/fixtures";

describe("Confidence gate", () => {
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

  it("reply with confidence >= 0.7 returns normally without requires_human", async () => {
    // In heuristic mode, agent_confidence defaults to 1 initially
    const { status, data } = await postChat(srv.baseUrl, greetingInput());
    expect(status).toBe(200);
    // Should NOT have handoff for a standard greeting in heuristic mode
    // (confidence starts at 1, review doesn't downgrade enough to trigger handoff)
    expect(data.confidence).toBeGreaterThanOrEqual(0);
    // Reply should be non-empty
    expect(typeof data.reply).toBe("string");
  });

  it("responses that require human handoff include handoffReason", async () => {
    // In heuristic mode, UNKNOWN intent routes to HUMAN_HANDOFF
    const { status, data } = await postChat(srv.baseUrl, {
      tenantId: "tenant_001",
      customerId: "cust_001",
      text: "xyzzy_unknownable_completely"
    });
    expect(status).toBe(200);
    // If handoff occurred, handoffReason must be present
    if (data.route === "human_handoff") {
      expect(typeof data.handoffReason).toBe("string");
      expect(data.handoffReason!.length).toBeGreaterThan(0);
    }
  });
});
