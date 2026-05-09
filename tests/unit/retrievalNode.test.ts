import { describe, it, expect, vi, beforeEach } from "vitest";
import { HumanMessage } from "@langchain/core/messages";
import { AgentState, RouteTarget, UserIntent, createInitialState } from "../../src/types";

const mockSearch = vi.fn();
const mockReadDetail = vi.fn();

vi.mock("../../src/clients/resolve-ov-client", () => ({
  resolveOvClient: () => ({ search: mockSearch, readDetail: mockReadDetail }),
}));

vi.mock("../../src/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { buildEnhancedQuery, retrievalNode } from "../../src/nodes/retrievalNode";

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  const base = createInitialState({
    sessionId: "sess-1",
    userId: "user-1",
    tenantId: "tenant-1",
    customerId: "cust-1",
    userMessage: new HumanMessage("I want a red dress"),
  });
  return { ...base, ...overrides };
}

function makeSearchResult(items: Array<{ uri: string; abstract: string; score: number }>) {
  return {
    memories: [],
    resources: items.map((i) => ({ ...i, context_type: "resource" })),
    skills: [],
    total: items.length,
  };
}

describe("buildEnhancedQuery", () => {
  it("appends preferences not already in text", () => {
    const result = buildEnhancedQuery("I want a dress", {
      preferences: [{ abstract: "red, silk" }],
    });
    expect(result).toBe("I want a dress red silk");
  });

  it("deduplicates terms already in user text", () => {
    const result = buildEnhancedQuery("I want a red dress", {
      preferences: [{ abstract: "red, large" }],
    });
    // "red" is already in text, "large" is novel
    expect(result).toContain("large");
    expect(result).not.toMatch(/red.*red/i);
  });

  it("returns original text when context is null", () => {
    expect(buildEnhancedQuery("hello", null)).toBe("hello");
  });

  it("returns original text when context is undefined", () => {
    expect(buildEnhancedQuery("hello", undefined)).toBe("hello");
  });

  it("appends entity terms", () => {
    const result = buildEnhancedQuery("show me options", {
      entities: [{ abstract: "Nike shoes" }],
    });
    expect(result).toContain("Nike");
    expect(result).toContain("shoes");
  });

  it("combines preferences and entities", () => {
    const result = buildEnhancedQuery("find something", {
      preferences: [{ abstract: "blue" }],
      entities: [{ abstract: "Adidas" }],
    });
    expect(result).toContain("blue");
    expect(result).toContain("Adidas");
  });

  it("returns original when all terms already present", () => {
    const result = buildEnhancedQuery("I like red shoes", {
      preferences: [{ abstract: "red" }],
      entities: [{ abstract: "shoes" }],
    });
    expect(result).toBe("I like red shoes");
  });
});

describe("retrievalNode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch.mockResolvedValue(makeSearchResult([]));
    mockReadDetail.mockResolvedValue("detail content");
  });

  // --- Skip routes ---
  describe("skip routes", () => {
    it("skips ORDER_AGENT", async () => {
      const state = makeState({ route_target: RouteTarget.ORDER_AGENT });
      const result = await retrievalNode(state);
      expect(result.retrieved_context).toBeNull();
      expect(mockSearch).not.toHaveBeenCalled();
    });

    it("skips HUMAN_HANDOFF", async () => {
      const state = makeState({ route_target: RouteTarget.HUMAN_HANDOFF });
      const result = await retrievalNode(state);
      expect(result.retrieved_context).toBeNull();
    });

    it("skips CONVERSATION_CLOSING", async () => {
      const state = makeState({ route_target: RouteTarget.CONVERSATION_CLOSING });
      const result = await retrievalNode(state);
      expect(result.retrieved_context).toBeNull();
    });
  });

  // --- Sales route ---
  describe("SALES_AGENT route", () => {
    it("searches products and tags relevance", async () => {
      mockSearch.mockResolvedValue(
        makeSearchResult([
          { uri: "viking://resources/products/p1", abstract: "Red dress", score: 0.85 },
          { uri: "viking://resources/products/p2", abstract: "Blue dress", score: 0.5 },
        ])
      );

      const state = makeState({ route_target: RouteTarget.SALES_AGENT });
      const result = await retrievalNode(state);

      expect(result.retrieved_context!.products).toHaveLength(2);
      expect(result.retrieved_context!.products[0].relevance).toBe("high");
      expect(result.retrieved_context!.products[1].relevance).toBe("medium");
    });

    it("reads detail for top-1 when score > 0.7", async () => {
      mockSearch.mockResolvedValue(
        makeSearchResult([
          { uri: "viking://resources/products/p1", abstract: "Silk dress", score: 0.85 },
        ])
      );

      const state = makeState({ route_target: RouteTarget.SALES_AGENT });
      const result = await retrievalNode(state);

      expect(mockReadDetail).toHaveBeenCalledTimes(1);
      expect(result.retrieved_context!.topDetails).toHaveLength(1);
    });
  });

  // --- Knowledge route ---
  describe("KNOWLEDGE_AGENT route", () => {
    it("searches knowledge with correct URI", async () => {
      mockSearch.mockResolvedValue(
        makeSearchResult([
          { uri: "viking://resources/knowledge/faq1", abstract: "Return policy", score: 0.6 },
        ])
      );

      const state = makeState({ route_target: RouteTarget.KNOWLEDGE_AGENT });
      const result = await retrievalNode(state);

      expect(mockSearch).toHaveBeenCalledWith(
        "tenant-1",
        "cust-1",
        expect.any(String),
        undefined,
        "viking://resources/knowledge/",
        5
      );
      expect(result.retrieved_context!.knowledge).toHaveLength(1);
    });
  });

  // --- Visual route ---
  describe("VISUAL_AGENT route", () => {
    it("uses media_description + user text as query", async () => {
      mockSearch.mockResolvedValue(makeSearchResult([]));

      const state = makeState({
        route_target: RouteTarget.VISUAL_AGENT,
        media_description: "a floral summer dress",
      });
      await retrievalNode(state);

      // Should contain both media_description and user text
      const callArgs = mockSearch.mock.calls[0];
      const queryArg = callArgs[2] as string;
      expect(queryArg).toContain("floral summer dress");
      expect(queryArg).toContain("red dress");
    });
  });

  // --- Chat route ---
  describe("CHAT_AGENT route", () => {
    it("searches products + knowledge in parallel (2 calls)", async () => {
      const state = makeState({ route_target: RouteTarget.CHAT_AGENT });
      await retrievalNode(state);

      expect(mockSearch).toHaveBeenCalledTimes(2);
      // First call: products with limit 3
      expect(mockSearch.mock.calls[0][5]).toBe(3);
      // Second call: knowledge with limit 3
      expect(mockSearch.mock.calls[1][5]).toBe(3);
    });
  });

  // --- Dual-path search ---
  describe("dual-path search", () => {
    it("fires 2 searches when enhanced differs from original", async () => {
      mockSearch.mockResolvedValue(makeSearchResult([]));

      const state = makeState({
        route_target: RouteTarget.SALES_AGENT,
        memory_context: {
          shortTerm: { recentMessages: [], sessionSummaries: [] },
          longTerm: {
            profile: null,
            preferences: [{ uri: "", abstract: "silk, luxury", score: 0.8 }],
            entities: [],
            events: [],
            cases: [],
            patterns: [],
          },
        },
      });
      await retrievalNode(state);

      // Enhanced query differs → 2 parallel searches
      expect(mockSearch).toHaveBeenCalledTimes(2);
    });

    it("fires single search when enhanced == original", async () => {
      mockSearch.mockResolvedValue(makeSearchResult([]));

      // No memory context → enhanced == original
      const state = makeState({
        route_target: RouteTarget.SALES_AGENT,
        memory_context: null,
      });
      await retrievalNode(state);

      expect(mockSearch).toHaveBeenCalledTimes(1);
    });

    it("deduplicates by URI keeping higher score", async () => {
      mockSearch
        .mockResolvedValueOnce(
          makeSearchResult([
            { uri: "viking://resources/products/p1", abstract: "Item A", score: 0.6 },
            { uri: "viking://resources/products/p2", abstract: "Item B", score: 0.5 },
          ])
        )
        .mockResolvedValueOnce(
          makeSearchResult([
            { uri: "viking://resources/products/p1", abstract: "Item A", score: 0.8 },
            { uri: "viking://resources/products/p3", abstract: "Item C", score: 0.4 },
          ])
        );

      const state = makeState({
        route_target: RouteTarget.SALES_AGENT,
        memory_context: {
          shortTerm: { recentMessages: [], sessionSummaries: [] },
          longTerm: {
            profile: null,
            preferences: [{ uri: "", abstract: "novelterm", score: 0.8 }],
            entities: [],
            events: [],
            cases: [],
            patterns: [],
          },
        },
      });
      const result = await retrievalNode(state);

      const products = result.retrieved_context!.products;
      // p1 appears once with higher score (0.8)
      const p1 = products.find((p) => p.uri.includes("p1"));
      expect(p1!.score).toBe(0.8);
      // 3 unique items total
      expect(products).toHaveLength(3);
    });
  });

  // --- Smart readDetail ---
  describe("smart readDetail", () => {
    it("reads 1 detail when top-1 score > 0.7", async () => {
      mockSearch.mockResolvedValue(
        makeSearchResult([
          { uri: "viking://resources/products/p1", abstract: "A", score: 0.85 },
          { uri: "viking://resources/products/p2", abstract: "B", score: 0.6 },
        ])
      );

      const state = makeState({ route_target: RouteTarget.SALES_AGENT });
      await retrievalNode(state);

      expect(mockReadDetail).toHaveBeenCalledTimes(1);
      expect(mockReadDetail).toHaveBeenCalledWith("tenant-1", "cust-1", "viking://resources/products/p1");
    });

    it("reads 2 details when top-1 score 0.4-0.7", async () => {
      mockSearch.mockResolvedValue(
        makeSearchResult([
          { uri: "viking://resources/products/p1", abstract: "A", score: 0.6 },
          { uri: "viking://resources/products/p2", abstract: "B", score: 0.5 },
          { uri: "viking://resources/products/p3", abstract: "C", score: 0.3 },
        ])
      );

      const state = makeState({ route_target: RouteTarget.SALES_AGENT });
      await retrievalNode(state);

      expect(mockReadDetail).toHaveBeenCalledTimes(2);
    });

    it("reads 0 details when top-1 score < 0.4", async () => {
      mockSearch.mockResolvedValue(
        makeSearchResult([
          { uri: "viking://resources/products/p1", abstract: "A", score: 0.3 },
        ])
      );

      const state = makeState({ route_target: RouteTarget.SALES_AGENT });
      await retrievalNode(state);

      expect(mockReadDetail).not.toHaveBeenCalled();
    });
  });

  // --- Tenant config ---
  describe("tenant config", () => {
    it("uses custom searchScopes URI", async () => {
      mockSearch.mockResolvedValue(makeSearchResult([]));

      const state = makeState({
        route_target: RouteTarget.SALES_AGENT,
        tenant_config: {
          knowledgeSchema: {
            productCategories: [],
            knowledgeTypes: [],
            searchScopes: {
              product_inquiry: "viking://resources/custom-products/",
              knowledge_query: "viking://resources/custom-kb/",
            },
          },
        },
      });
      await retrievalNode(state);

      expect(mockSearch).toHaveBeenCalledWith(
        "tenant-1",
        "cust-1",
        expect.any(String),
        undefined,
        "viking://resources/custom-products/",
        5
      );
    });
  });

  // --- Error handling ---
  describe("error handling", () => {
    it("returns empty context on OV failure", async () => {
      mockSearch.mockRejectedValue(new Error("OV down"));

      const state = makeState({ route_target: RouteTarget.SALES_AGENT });
      const result = await retrievalNode(state);

      expect(result.retrieved_context!.products).toEqual([]);
      expect(result.retrieved_context!.knowledge).toEqual([]);
      expect(result.retrieved_context!.topDetails).toEqual([]);
    });
  });

  // --- Session ID ---
  describe("session ID handling", () => {
    it("passes undefined for local_ prefix session ID", async () => {
      mockSearch.mockResolvedValue(makeSearchResult([]));

      const state = makeState({
        route_target: RouteTarget.SALES_AGENT,
        openviking_session_id: "local_12345",
      });
      await retrievalNode(state);

      expect(mockSearch).toHaveBeenCalledWith(
        "tenant-1",
        "cust-1",
        expect.any(String),
        undefined, // session ID should be undefined
        expect.any(String),
        5
      );
    });

    it("passes real session ID when not local_", async () => {
      mockSearch.mockResolvedValue(makeSearchResult([]));

      const state = makeState({
        route_target: RouteTarget.SALES_AGENT,
        openviking_session_id: "real-session-123",
      });
      await retrievalNode(state);

      expect(mockSearch).toHaveBeenCalledWith(
        "tenant-1",
        "cust-1",
        expect.any(String),
        "real-session-123",
        expect.any(String),
        5
      );
    });
  });

  // --- Trace ---
  describe("trace", () => {
    it("always returns a trace entry", async () => {
      mockSearch.mockResolvedValue(makeSearchResult([]));

      const state = makeState({ route_target: RouteTarget.SALES_AGENT });
      const result = await retrievalNode(state);

      const trace = result.trace!;
      const entry = trace[trace.length - 1];
      expect(entry.node).toBe("retrievalNode");
      expect(entry.displayName).toBe("Retrieval");
    });

    it("returns trace entry on skip", async () => {
      const state = makeState({ route_target: RouteTarget.ORDER_AGENT });
      const result = await retrievalNode(state);

      const trace = result.trace!;
      expect(trace[trace.length - 1].node).toBe("retrievalNode");
    });

    it("returns trace entry on error", async () => {
      mockSearch.mockRejectedValue(new Error("fail"));

      const state = makeState({ route_target: RouteTarget.SALES_AGENT });
      const result = await retrievalNode(state);

      const trace = result.trace!;
      const entry = trace[trace.length - 1];
      expect(entry.output).toContain("Error");
    });
  });
});
