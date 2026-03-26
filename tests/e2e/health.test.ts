import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import http from "http";
import { startTestServer, type TestServer } from "./helpers/server-factory";
import { getHealth, postChat } from "./helpers/chat-client";
import { mockOpenVikingAll, cleanNock } from "./helpers/nock-openviking";

const postRaw = (baseUrl: string, path: string, body: string): Promise<{ status: number; data: unknown }> => {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}${path}`);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode ?? 0, data });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
};

describe("Alice health and error handling", () => {
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

  it("GET /health returns 200", async () => {
    const { status, data } = await getHealth(srv.baseUrl);
    expect(status).toBe(200);
    expect((data as any).ok).toBe(true);
  });

  it("POST unknown route returns 404", async () => {
    const { status } = await postRaw(srv.baseUrl, "/unknown/route", "{}");
    expect(status).toBe(404);
  });

  it("POST /v1/chat without tenantId returns 500", async () => {
    const { status, data } = await postRaw(
      srv.baseUrl,
      "/v1/chat",
      JSON.stringify({ customerId: "c1", text: "hello" })
    );
    expect(status).toBe(500);
    expect((data as any).error).toMatch(/tenantId/i);
  });

  it("POST /v1/chat with invalid JSON returns 500", async () => {
    const { status } = await postRaw(srv.baseUrl, "/v1/chat", "not-json{{{");
    expect(status).toBe(500);
  });
});
