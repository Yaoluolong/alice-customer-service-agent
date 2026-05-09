import { describe, it, expect, vi, beforeEach } from "vitest";
import { HumanMessage } from "@langchain/core/messages";
import { AgentState, UserIntent, RouteTarget, MediaContext } from "../../src/types";

// Mock model factory before importing the node
const mockInvoke = vi.fn();
vi.mock("../../src/config/models", () => ({
  getConfiguredModel: vi.fn(() => ({
    invoke: mockInvoke,
  })),
}));

vi.mock("../../src/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Import after mocks
import { mediaDescribeNode } from "../../src/nodes/mediaDescribeNode";

const makeState = (overrides: Partial<AgentState> = {}): AgentState => ({
  messages: [new HumanMessage("这个包包多少钱")],
  user_id: "u1",
  session_id: "s1",
  tenant_id: "t1",
  customer_id: "c1",
  tenant_config: null,
  user_intent: UserIntent.UNKNOWN,
  route_target: RouteTarget.VISUAL_AGENT,
  current_product_id: null,
  image_context: null,
  media_context: null,
  memory_context: null,
  openviking_session_id: null,
  openviking_message_count: 0,
  retrieved_products: [],
  user_preferences: [],
  requires_human: false,
  grounding_facts: null,
  draft_reply: null,
  tone_applied: null,
  variation_id: null,
  agent_confidence: 1,
  review_flags: [],
  confidence_reasons: [],
  handoff_reason: null,
  reply_language: "zh-CN",
  conversation_summary: null,
  style_profile: { addressStyle: "你", verbosity: "normal", formality: "neutral", warmth: 0.7 },
  recent_opening_templates: [],
  retrieved_context: null,
  media_description: null,
  intent_confidence: 1.0,
  intent_candidates: [],
  requires_clarification: false,
  conversation_closing: false,
  trace: [],
  ...overrides,
});

const makeMedia = (overrides: Partial<MediaContext> = {}): MediaContext => ({
  mediaId: "img_001",
  mediaType: "image",
  mimeType: "image/jpeg",
  base64Data: "abc123base64",
  ...overrides,
});

describe("mediaDescribeNode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue({ content: "A red leather handbag with gold chain" });
  });

  it("calls VLM and writes media_description", async () => {
    const state = makeState({ media_context: makeMedia() });
    const result = await mediaDescribeNode(state);

    expect(mockInvoke).toHaveBeenCalledOnce();
    expect(result.media_description).toBe("A red leather handbag with gold chain");
  });

  it("skips VLM when media_description already exists", async () => {
    const state = makeState({
      media_context: makeMedia(),
      media_description: "existing description",
    });
    const result = await mediaDescribeNode(state);

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(result.media_description).toBeUndefined(); // not overwritten
    expect(result.trace).toHaveLength(1);
    expect(result.trace![0].node).toBe("media_describe");
    expect(result.trace![0].metadata?.skipped).toBe(true);
  });

  it("returns null when no media context", async () => {
    const state = makeState();
    const result = await mediaDescribeNode(state);

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(result.media_description).toBeNull();
    expect(result.trace).toHaveLength(1);
    expect(result.trace![0].metadata?.reason).toBe("no_media");
  });

  it("falls back to user text on VLM failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("VLM timeout"));
    const state = makeState({ media_context: makeMedia() });
    const result = await mediaDescribeNode(state);

    expect(result.media_description).toBe("这个包包多少钱");
  });

  it("falls back to 'product image' when VLM fails and no user text", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("VLM timeout"));
    const state = makeState({ messages: [], media_context: makeMedia() });
    const result = await mediaDescribeNode(state);

    expect(result.media_description).toBe("product image");
  });

  it("uses image_context when media_context is null", async () => {
    const state = makeState({
      image_context: {
        imageId: "img_002",
        base64Data: "xyz789",
        mimeType: "image/png",
      },
    });
    const result = await mediaDescribeNode(state);

    expect(mockInvoke).toHaveBeenCalledOnce();
    expect(result.media_description).toBe("A red leather handbag with gold chain");
  });

  it("uses URL when base64Data is absent", async () => {
    const state = makeState({
      media_context: makeMedia({ base64Data: undefined, url: "https://example.com/img.jpg" }),
    });
    const result = await mediaDescribeNode(state);

    expect(mockInvoke).toHaveBeenCalledOnce();
    // Verify the message content includes image_url with the URL
    const call = mockInvoke.mock.calls[0][0];
    const msgContent = call[0].content;
    expect(msgContent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "image_url", image_url: expect.objectContaining({ url: "https://example.com/img.jpg" }) }),
      ])
    );
  });

  it("always returns a trace entry with node media_describe", async () => {
    // With media
    const state1 = makeState({ media_context: makeMedia() });
    const r1 = await mediaDescribeNode(state1);
    expect(r1.trace).toHaveLength(1);
    expect(r1.trace![0].node).toBe("media_describe");

    // Without media
    vi.clearAllMocks();
    const state2 = makeState();
    const r2 = await mediaDescribeNode(state2);
    expect(r2.trace).toHaveLength(1);
    expect(r2.trace![0].node).toBe("media_describe");

    // With existing description
    vi.clearAllMocks();
    const state3 = makeState({ media_description: "exists" });
    const r3 = await mediaDescribeNode(state3);
    expect(r3.trace).toHaveLength(1);
    expect(r3.trace![0].node).toBe("media_describe");
  });
});
