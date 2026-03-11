import "./config/env";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { customerServiceAgentService } from "./service";
import { ChatInput } from "./types";

const PORT = Number(process.env.PORT ?? 3000);

const sendJson = (res: ServerResponse, statusCode: number, payload: unknown): void => {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
};

const readBody = async (req: IncomingMessage): Promise<string> => {
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

  const obj = parsed as Partial<ChatInput>;

  if (!obj.userId || typeof obj.userId !== "string") {
    throw new Error("userId is required");
  }
  if (!obj.text || typeof obj.text !== "string") {
    throw new Error("text is required");
  }

  return {
    userId: obj.userId,
    sessionId: typeof obj.sessionId === "string" ? obj.sessionId : undefined,
    text: obj.text,
    image: obj.image
  };
};

const server = createServer(async (req, res) => {
  try {
    if (!req.url || !req.method) {
      sendJson(res, 400, { error: "invalid request" });
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, { ok: true, service: "multimodal-cs-agent" });
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
      const session = customerServiceAgentService.getSession(sessionId);
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

server.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log("[server] POST /v1/chat, GET /v1/sessions/:id, GET /health");
});
