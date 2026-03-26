import http from "http";

export interface ChatRequest {
  tenantId: string;
  customerId: string;
  userId?: string;
  sessionId?: string;
  text: string;
  image?: unknown;
  media?: unknown;
}

export interface ChatResponse {
  sessionId: string;
  reply: string;
  intent: string;
  route: string;
  productId: string | null;
  trace: string[];
  confidence: number;
  handoffReason?: string;
  reviewFlags: string[];
  replyLanguage: string;
  openVikingSessionId: string;
  memoriesLoaded: number;
}

export const postChat = (baseUrl: string, body: ChatRequest): Promise<{ status: number; data: ChatResponse }> => {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ userId: body.customerId, ...body });
    const url = new URL(`${baseUrl}/v1/chat`);

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload)
        }
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode ?? 0, data: data as any });
          }
        });
      }
    );

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
};

export const getHealth = (baseUrl: string): Promise<{ status: number; data: unknown }> => {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/health`);
    http
      .get({ hostname: url.hostname, port: url.port, path: "/health" }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, data: JSON.parse(data) }));
      })
      .on("error", reject);
  });
};

export const getSession = (baseUrl: string, sessionId: string): Promise<{ status: number; data: unknown }> => {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}`);
    http
      .get({ hostname: url.hostname, port: url.port, path: url.pathname }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode ?? 0, data });
          }
        });
      })
      .on("error", reject);
  });
};
