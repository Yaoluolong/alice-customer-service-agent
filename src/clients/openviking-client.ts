import axios, { AxiosInstance } from "axios";
import { circuitBreaker, ConsecutiveBreaker, handleAll } from "cockatiel";
import { appConfig } from "../config/env";
import { logger } from "../logger";

export interface SessionInfo {
  session_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
}

export interface MessagePart {
  type: "text" | "context" | "tool";
  text?: string;
  uri?: string;
  context_type?: string;
  abstract?: string;
}

export interface SearchItem {
  uri: string;
  abstract: string;
  score: number;
  context_type?: string;
  is_leaf?: boolean;
  match_reason?: string;
}

export interface SearchResult {
  memories: SearchItem[];
  resources: SearchItem[];
  skills: SearchItem[];
  total: number;
}

export class OpenVikingHttpClient {
  private readonly http: AxiosInstance;
  private readonly breaker: ReturnType<typeof circuitBreaker>;

  constructor(baseUrl?: string, apiKey?: string | null) {
    const base = baseUrl ?? appConfig.openviking.baseUrl;
    const key = apiKey !== undefined ? apiKey : appConfig.openviking.apiKey;

    this.http = axios.create({
      baseURL: base,
      timeout: 30000,
      headers: key ? { "X-API-Key": key } : {}
    });

    this.breaker = circuitBreaker(handleAll, {
      breaker: new ConsecutiveBreaker(5),
      halfOpenAfter: 60_000,
    });

    this.breaker.onBreak(() => {
      logger.warn("openviking-client circuit breaker OPEN — OpenViking appears down");
    });
    this.breaker.onReset(() => {
      logger.info("openviking-client circuit breaker CLOSED — OpenViking recovered");
    });
  }

  private headers(tenantId: string, customerId: string): Record<string, string> {
    return {
      "X-OpenViking-Account": tenantId,
      "X-OpenViking-User": customerId,
      "X-OpenViking-Agent": "alice"
    };
  }

  async createSession(tenantId: string, customerId: string): Promise<{ session_id: string }> {
    const res = await this.breaker.execute(() =>
      this.http.post("/api/v1/sessions", {}, { headers: this.headers(tenantId, customerId) })
    );
    return res.data.result as { session_id: string };
  }

  async listSessions(tenantId: string, customerId: string): Promise<SessionInfo[]> {
    const res = await this.breaker.execute(() =>
      this.http.get("/api/v1/sessions", { headers: this.headers(tenantId, customerId) })
    );
    const result = res.data.result;
    if (Array.isArray(result)) return result as SessionInfo[];
    if (result && Array.isArray(result.sessions)) return result.sessions as SessionInfo[];
    return [];
  }

  async addMessage(
    tenantId: string,
    customerId: string,
    sessionId: string,
    role: "user" | "assistant",
    parts: MessagePart[]
  ): Promise<void> {
    await this.breaker.execute(() =>
      this.http.post(
        `/api/v1/sessions/${sessionId}/messages`,
        { role, parts },
        { headers: this.headers(tenantId, customerId) }
      )
    );
  }

  async commitSession(
    tenantId: string,
    customerId: string,
    sessionId: string,
    wait = false
  ): Promise<void> {
    await this.breaker.execute(() =>
      this.http.post(
        `/api/v1/sessions/${sessionId}/commit`,
        {},
        { params: { wait }, headers: this.headers(tenantId, customerId) }
      )
    );
  }

  async findMemories(
    tenantId: string,
    customerId: string,
    query: string,
    targetUri?: string,
    limit = 10
  ): Promise<SearchResult> {
    const res = await this.breaker.execute(() =>
      this.http.post(
        "/api/v1/search/find",
        { query, target_uri: targetUri ?? "viking://user/memories/", limit },
        { headers: this.headers(tenantId, customerId) }
      )
    );
    return res.data.result as SearchResult;
  }

  async searchKnowledge(
    tenantId: string,
    query: string,
    targetUri = "viking://resources/",
    limit = 5
  ): Promise<SearchResult> {
    const res = await this.breaker.execute(() =>
      this.http.post(
        "/api/v1/search/find",
        { query, target_uri: targetUri, limit },
        { headers: { "X-OpenViking-Account": tenantId, "X-OpenViking-Agent": "alice" } }
      )
    );
    return res.data.result as SearchResult;
  }

  async search(
    tenantId: string,
    customerId: string,
    query: string,
    sessionId?: string,
    targetUri = "",
    limit = 5
  ): Promise<SearchResult> {
    const res = await this.breaker.execute(() =>
      this.http.post(
        "/api/v1/search/search",
        { query, target_uri: targetUri, session_id: sessionId, limit },
        { headers: this.headers(tenantId, customerId) }
      )
    );
    return res.data.result as SearchResult;
  }

  /** Get L1 overview (~2k tokens) for a viking:// URI */
  async getOverview(tenantId: string, customerId: string, uri: string): Promise<string> {
    const res = await this.breaker.execute(() =>
      this.http.get("/api/v1/content/overview", {
        params: { uri },
        headers: this.headers(tenantId, customerId)
      })
    );
    return (res.data.result ?? "") as string;
  }

  /** Get L2 full detail for a viking:// URI */
  async readDetail(tenantId: string, customerId: string, uri: string): Promise<string> {
    const res = await this.breaker.execute(() =>
      this.http.get("/api/v1/content/read", {
        params: { uri },
        headers: this.headers(tenantId, customerId)
      })
    );
    return (res.data.result ?? "") as string;
  }

  async sessionUsed(
    tenantId: string,
    customerId: string,
    sessionId: string,
    contextUris: string[]
  ): Promise<void> {
    if (contextUris.length === 0) return;
    await this.breaker.execute(() =>
      this.http.post(
        `/api/v1/sessions/${sessionId}/used`,
        { contexts: contextUris },
        { headers: this.headers(tenantId, customerId) }
      )
    );
  }
}

export const openVikingClient = new OpenVikingHttpClient();
