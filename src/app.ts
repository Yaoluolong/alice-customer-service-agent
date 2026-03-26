import { createServer } from "http";
import type { Server } from "http";
import { customerServiceAgentService } from "./service";
import { registry } from "./metrics";
import { ChatInput } from "./types";

const sendJson = (res: import("http").ServerResponse, statusCode: number, payload: unknown): void => {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
};

const readBody = async (req: import("http").IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
};

const parseChatInput = (body: string): ChatInput => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("invalid JSON body");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("body must be an object");
  }

  const obj = parsed as Record<string, unknown>;

  if (!obj.tenantId || typeof obj.tenantId !== "string") {
    throw new Error("tenantId is required");
  }
  if (!obj.customerId || typeof obj.customerId !== "string") {
    throw new Error("customerId is required");
  }
  if (!obj.text || typeof obj.text !== "string") {
    throw new Error("text is required");
  }

  const userId = typeof obj.userId === "string" ? obj.userId : obj.customerId;

  return {
    tenantId: obj.tenantId,
    customerId: obj.customerId,
    userId,
    sessionId: typeof obj.sessionId === "string" ? obj.sessionId : undefined,
    text: obj.text,
    image: obj.image as ChatInput["image"],
    media: obj.media as ChatInput["media"],
    tenantConfig: obj.tenantConfig as ChatInput["tenantConfig"]
  };
};

export const createAliceServer = (): Server => {
  return createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) {
        sendJson(res, 400, { error: "invalid request" });
        return;
      }

      if (req.method === "GET" && req.url === "/health") {
        sendJson(res, 200, { ok: true, service: "multimodal-cs-agent" });
        return;
      }

      if (req.method === "GET" && req.url === "/metrics") {
        const metrics = await registry.metrics();
        res.writeHead(200, { "Content-Type": registry.contentType });
        res.end(metrics);
        return;
      }

      if (req.method === "POST" && req.url === "/v1/chat") {
        const body = await readBody(req);
        const input = parseChatInput(body);
        const result = await customerServiceAgentService.chat(input);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "GET" && req.url.startsWith("/v1/sessions/")) {
        const sessionId = decodeURIComponent(req.url.replace("/v1/sessions/", ""));
        const session = await customerServiceAgentService.getSession(sessionId);
        if (!session) {
          sendJson(res, 404, { error: "session not found" });
          return;
        }
        sendJson(res, 200, session);
        return;
      }

      sendJson(res, 404, { error: "not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "internal error";
      sendJson(res, 500, { error: message });
    }
  });
};
