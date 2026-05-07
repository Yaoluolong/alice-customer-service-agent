import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { startTestServer, type TestServer } from "./helpers/server-factory";
import { postChat } from "./helpers/chat-client";
import { mockOpenVikingAll, cleanNock } from "./helpers/nock-openviking";
import { makeChatInput } from "./helpers/fixtures";

describe("Routing Policy (configurable intent router)", () => {
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

  describe("defaultAgent", () => {
    it("routes general_chat to salesAgent when defaultAgent is sales_agent", async () => {
      const input = makeChatInput({
        text: "你好",
        tenantConfig: {
          routingPolicy: {
            defaultAgent: "sales_agent",
          },
        },
      } as any);

      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);
      expect(data.intent).toBe("general_chat");
      expect(data.route).toBe("sales_agent");
    });

    it("routes unknown intent to defaultAgent", async () => {
      const input = makeChatInput({
        text: "asdfghjkl random gibberish xyz",
        tenantConfig: {
          routingPolicy: {
            defaultAgent: "knowledge_agent",
          },
        },
      } as any);

      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);
      expect(data.intent).toBe("unknown");
      expect(data.route).toBe("knowledge_agent");
    });

    it("falls back to chat_agent when defaultAgent is not set", async () => {
      const input = makeChatInput({ text: "你好" });
      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);
      expect(data.intent).toBe("general_chat");
      expect(data.route).toBe("chat_agent");
    });
  });

  describe("intentMapping", () => {
    it("overrides product_inquiry to route to knowledgeAgent", async () => {
      const input = makeChatInput({
        text: "红色风衣有M码吗",
        tenantConfig: {
          routingPolicy: {
            intentMapping: {
              product_inquiry: "knowledge_agent",
            },
          },
        },
      } as any);

      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);
      expect(data.intent).toBe("product_inquiry");
      expect(data.route).toBe("knowledge_agent");
    });

    it("intentMapping does not affect intents without override", async () => {
      const input = makeChatInput({
        text: "我的订单到哪了",
        tenantConfig: {
          routingPolicy: {
            intentMapping: {
              product_inquiry: "knowledge_agent",
            },
          },
        },
      } as any);

      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);
      expect(data.intent).toBe("order_status");
      expect(data.route).toBe("order_agent");
    });
  });

  describe("enabledAgents interaction", () => {
    it("falls back to defaultAgent when mapped agent is disabled", async () => {
      const input = makeChatInput({
        text: "红色风衣有M码吗",
        tenantConfig: {
          enabledAgents: ["chat_agent", "knowledge_agent"],
          routingPolicy: {
            defaultAgent: "knowledge_agent",
          },
        },
      } as any);

      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);
      expect(data.intent).toBe("product_inquiry");
      // sales_agent is disabled, should fall back to defaultAgent (knowledge_agent)
      expect(data.route).toBe("knowledge_agent");
    });

    it("falls back to chat_agent when both mapped and default agents are disabled", async () => {
      const input = makeChatInput({
        text: "红色风衣有M码吗",
        tenantConfig: {
          enabledAgents: ["chat_agent"],
          routingPolicy: {
            defaultAgent: "sales_agent",
          },
        },
      } as any);

      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);
      expect(data.intent).toBe("product_inquiry");
      // sales_agent disabled, defaultAgent (sales_agent) also disabled, ultimate fallback
      expect(data.route).toBe("chat_agent");
    });
  });

  describe("Layer 0: hard rules unaffected", () => {
    it("media always routes to visual_agent regardless of routingPolicy", async () => {
      const input = makeChatInput({
        text: "[media]",
        media: {
          mediaId: "media_001",
          mediaType: "image" as const,
          base64Data: "dGVzdA==",
          mimeType: "image/jpeg",
          description: "A red coat",
        },
        tenantConfig: {
          routingPolicy: {
            defaultAgent: "sales_agent",
            intentMapping: {
              visual_search: "sales_agent",
            },
          },
        },
      } as any);

      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);
      // Layer 0 hard rule: media → visual, intentMapping cannot override this
      expect(data.route).toBe("visual_agent");
    });
  });
});
