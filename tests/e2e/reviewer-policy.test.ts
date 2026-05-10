import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { startTestServer, type TestServer } from "./helpers/server-factory";
import { postChat } from "./helpers/chat-client";
import { mockOpenVikingAll, cleanNock } from "./helpers/nock-openviking";
import { makeChatInput } from "./helpers/fixtures";

describe("Reviewer Policy", () => {
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

  // ───────────────────────────────────────────────
  // 1. confidenceThreshold tenant config bug fix
  // ───────────────────────────────────────────────
  describe("confidenceThreshold from tenant config", () => {
    it("uses tenant confidenceThreshold — threshold=1.0 triggers handoff", async () => {
      const input = makeChatInput({
        text: "你好",
        tenantConfig: {
          confidenceThreshold: 1.0,
        },
      } as any);

      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);
      // With threshold=1.0, heuristic score (~0.30 for greeting with no grounding facts)
      // should be below threshold, triggering handoff
      expect(data.route).toBe("human_handoff");
    });

    it("does not handoff when tenant threshold is very low", async () => {
      const input = makeChatInput({
        text: "你好",
        tenantConfig: {
          confidenceThreshold: 0.01,
        },
      } as any);

      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);
      expect(data.route).not.toBe("human_handoff");
    });

    it("falls back to env default when tenant threshold is not set", async () => {
      // AGENT_CONFIDENCE_THRESHOLD=0 in test env, so no handoff expected
      const input = makeChatInput({ text: "你好" });
      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);
      // With env threshold=0 (test setup), no handoff
      expect(data.route).not.toBe("human_handoff");
    });
  });

  // ───────────────────────────────────────────────
  // 2. enabledDimensions
  // ───────────────────────────────────────────────
  describe("enabledDimensions", () => {
    it("skips disabled dimensions — no grounding_facts flag when dimension disabled", async () => {
      const input = makeChatInput({
        text: "红色风衣有M码吗？多少钱？",
        tenantConfig: {
          confidenceThreshold: 0,
          reviewerPolicy: {
            enabledDimensions: ["length", "completeness"],
          },
        },
      } as any);

      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);
      expect(data.reviewFlags).not.toContain("no_grounding_facts");
      expect(data.reviewFlags).not.toContain("contains_unknowns");
      expect(data.reviewFlags).not.toContain("mechanical_phrase");
      expect(data.reviewFlags).not.toContain("tone_mismatch");
    });

    it("enables all dimensions when enabledDimensions is not set", async () => {
      const input = makeChatInput({
        text: "红色风衣有M码吗？多少钱？",
        tenantConfig: {
          confidenceThreshold: 0,
        },
      } as any);

      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);
      // With no grounding facts from mock OV, this flag should appear
      expect(data.reviewFlags).toContain("no_grounding_facts");
    });

    it("disabling completeness removes incomplete_answer flag", async () => {
      // Send a multi-question message that would normally trigger incomplete_answer
      const input = makeChatInput({
        text: "红色风衣有M码吗？多少钱？什么材质？",
        tenantConfig: {
          confidenceThreshold: 0,
          reviewerPolicy: {
            // Enable all except completeness
            enabledDimensions: [
              "grounding_facts", "unknowns", "length", "mechanical_phrase",
              "repetitive_opening", "coherence", "tone_match",
            ],
          },
        },
      } as any);

      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);
      expect(data.reviewFlags).not.toContain("incomplete_answer");
    });

    it("disables all dimensions when enabledDimensions is empty array", async () => {
      const input = makeChatInput({
        text: "红色风衣有M码吗？多少钱？",
        tenantConfig: {
          confidenceThreshold: 0,
          reviewerPolicy: {
            enabledDimensions: [],
          },
        },
      } as any);

      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);
      // No heuristic flags should be present since all dimensions disabled
      const heuristicFlags = [
        "no_grounding_facts", "contains_unknowns", "too_short",
        "mechanical_phrase", "repetitive_opening", "incomplete_answer",
        "incoherent", "tone_mismatch",
      ];
      for (const flag of heuristicFlags) {
        expect(data.reviewFlags).not.toContain(flag);
      }
    });
  });

  // ───────────────────────────────────────────────
  // 3. Custom keyword rules
  // ───────────────────────────────────────────────
  describe("custom keyword rules", () => {
    it("flags keyword must_not_contain rule (penalty)", async () => {
      const input = makeChatInput({
        text: "你好",
        tenantConfig: {
          confidenceThreshold: 0,
          reviewerPolicy: {
            customRules: [
              {
                id: "rule_kw_1",
                name: "No confirm word",
                type: "keyword" as const,
                mode: "must_not_contain" as const,
                // Heuristic fallback reply always contains "确认" in the template
                pattern: ["确认", "信息"],
                action: "penalty" as const,
                penaltyScore: -0.1,
                enabled: true,
              },
            ],
          },
        },
      } as any);

      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);
      expect(data.reviewFlags).toContain("custom:rule_kw_1");
    });

    it("skips disabled custom rules", async () => {
      const input = makeChatInput({
        text: "你好",
        tenantConfig: {
          confidenceThreshold: 0,
          reviewerPolicy: {
            customRules: [
              {
                id: "rule_disabled",
                name: "Disabled rule",
                type: "keyword" as const,
                mode: "must_not_contain" as const,
                pattern: ["确认"],
                action: "penalty" as const,
                penaltyScore: -0.1,
                enabled: false,
              },
            ],
          },
        },
      } as any);

      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);
      expect(data.reviewFlags).not.toContain("custom:rule_disabled");
    });

    it("keyword must_contain rule triggers when pattern is absent", async () => {
      const input = makeChatInput({
        text: "你好",
        tenantConfig: {
          confidenceThreshold: 0,
          reviewerPolicy: {
            customRules: [
              {
                id: "rule_must_have",
                name: "Must say thank you",
                type: "keyword" as const,
                mode: "must_contain" as const,
                pattern: ["XYZZY_IMPOSSIBLE_TOKEN"],
                action: "penalty" as const,
                penaltyScore: -0.15,
                enabled: true,
              },
            ],
          },
        },
      } as any);

      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);
      // Reply won't contain the impossible token, so rule should fire
      expect(data.reviewFlags).toContain("custom:rule_must_have");
    });

    it("keyword must_contain rule does NOT trigger when pattern is present", async () => {
      const input = makeChatInput({
        text: "你好",
        tenantConfig: {
          confidenceThreshold: 0,
          reviewerPolicy: {
            customRules: [
              {
                id: "rule_has_greeting",
                name: "Must greet back",
                type: "keyword" as const,
                mode: "must_contain" as const,
                // Heuristic reply to "你好" should contain some Chinese chars
                pattern: ["你"],
                action: "penalty" as const,
                penaltyScore: -0.15,
                enabled: true,
              },
            ],
          },
        },
      } as any);

      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);
      expect(data.reviewFlags).not.toContain("custom:rule_has_greeting");
    });
  });

  // ───────────────────────────────────────────────
  // 4. Custom regex rules
  // ───────────────────────────────────────────────
  describe("custom regex rules", () => {
    it("regex must_contain rule triggers when pattern is missing", async () => {
      const input = makeChatInput({
        text: "你好",
        tenantConfig: {
          confidenceThreshold: 0,
          reviewerPolicy: {
            customRules: [
              {
                id: "rule_regex_price",
                name: "Must have price",
                type: "regex" as const,
                mode: "must_contain" as const,
                pattern: "\\d+(\\.\\d{2})?\\s*(元|¥|USD)",
                action: "penalty" as const,
                penaltyScore: -0.15,
                enabled: true,
              },
            ],
          },
        },
      } as any);

      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);
      expect(data.reviewFlags).toContain("custom:rule_regex_price");
    });

    it("invalid regex does not crash — rule is skipped", async () => {
      const input = makeChatInput({
        text: "你好",
        tenantConfig: {
          confidenceThreshold: 0,
          reviewerPolicy: {
            customRules: [
              {
                id: "rule_bad_regex",
                name: "Invalid regex",
                type: "regex" as const,
                mode: "must_not_contain" as const,
                pattern: "[invalid(",
                action: "penalty" as const,
                penaltyScore: -0.1,
                enabled: true,
              },
            ],
          },
        },
      } as any);

      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);
      // Invalid regex should be skipped, not flagged
      expect(data.reviewFlags).not.toContain("custom:rule_bad_regex");
    });
  });

  // ───────────────────────────────────────────────
  // 5. Hard reject rules
  // ───────────────────────────────────────────────
  describe("hard_reject rules", () => {
    it("hard_reject keyword rule adds flag", async () => {
      const input = makeChatInput({
        text: "你好",
        tenantConfig: {
          confidenceThreshold: 0,
          reviewerPolicy: {
            customRules: [
              {
                id: "rule_hard_1",
                name: "No confirm word",
                type: "keyword" as const,
                mode: "must_not_contain" as const,
                pattern: ["确认"],
                action: "hard_reject" as const,
                enabled: true,
              },
            ],
          },
        },
      } as any);

      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);
      expect(data.reviewFlags).toContain("custom:rule_hard_1");
    });

    it("multiple rules — penalty + hard_reject both flagged", async () => {
      const input = makeChatInput({
        text: "你好",
        tenantConfig: {
          confidenceThreshold: 0,
          reviewerPolicy: {
            customRules: [
              {
                id: "rule_penalty_multi",
                name: "Penalty rule",
                type: "keyword" as const,
                mode: "must_not_contain" as const,
                pattern: ["确认"],
                action: "penalty" as const,
                penaltyScore: -0.1,
                enabled: true,
              },
              {
                id: "rule_hard_multi",
                name: "Hard reject rule",
                type: "keyword" as const,
                mode: "must_contain" as const,
                pattern: ["IMPOSSIBLE_TOKEN"],
                action: "hard_reject" as const,
                enabled: true,
              },
            ],
          },
        },
      } as any);

      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);
      expect(data.reviewFlags).toContain("custom:rule_penalty_multi");
      expect(data.reviewFlags).toContain("custom:rule_hard_multi");
    });
  });

  // ───────────────────────────────────────────────
  // 6. Retry loop
  // ───────────────────────────────────────────────
  describe("retry loop", () => {
    it("retries when hard_reject + maxRetries > 0 — rewriter trace present", async () => {
      // In heuristic mode (no LLM), rewriteNode forces exhaustion.
      // But the graph topology should still route through the loop.
      const input = makeChatInput({
        text: "你好",
        tenantConfig: {
          confidenceThreshold: 0,
          reviewerPolicy: {
            maxRetries: 1,
            customRules: [
              {
                id: "rule_hard_retry",
                name: "No confirm word",
                type: "keyword" as const,
                mode: "must_not_contain" as const,
                pattern: ["确认"],
                action: "hard_reject" as const,
                enabled: true,
              },
            ],
          },
        },
      } as any);

      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);
      const traceNodes = (data.trace as any[]).map((t: any) => t.node);
      // Rewriter trace should be present (even if it skipped due to no LLM)
      expect(traceNodes).toContain("rewriter");
      // The rule should still be flagged (rewrite couldn't fix it without LLM)
      expect(data.reviewFlags).toContain("custom:rule_hard_retry");
    });

    it("no retry when maxRetries is 0 (default)", async () => {
      const input = makeChatInput({
        text: "你好",
        tenantConfig: {
          confidenceThreshold: 0,
          reviewerPolicy: {
            maxRetries: 0,
            customRules: [
              {
                id: "rule_no_retry",
                name: "No confirm word",
                type: "keyword" as const,
                mode: "must_not_contain" as const,
                pattern: ["确认"],
                action: "hard_reject" as const,
                enabled: true,
              },
            ],
          },
        },
      } as any);

      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);
      const traceNodes = (data.trace as any[]).map((t: any) => t.node);
      expect(traceNodes).not.toContain("rewriter");
    });

    it("no retry when no rules fail (even if maxRetries > 0)", async () => {
      const input = makeChatInput({
        text: "你好",
        tenantConfig: {
          confidenceThreshold: 0,
          reviewerPolicy: {
            maxRetries: 3,
            // No custom rules, and heuristic score with threshold=0 won't fail
          },
        },
      } as any);

      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);
      const traceNodes = (data.trace as any[]).map((t: any) => t.node);
      expect(traceNodes).not.toContain("rewriter");
    });

    it("exhausted retries with hard_reject triggers handoff via requires_human", async () => {
      const input = makeChatInput({
        text: "你好",
        tenantConfig: {
          confidenceThreshold: 0,
          reviewerPolicy: {
            maxRetries: 1,
            customRules: [
              {
                id: "rule_exhaust",
                name: "Always triggers",
                type: "keyword" as const,
                mode: "must_not_contain" as const,
                pattern: ["确认"],
                action: "hard_reject" as const,
                enabled: true,
              },
            ],
          },
        },
      } as any);

      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);
      // hard_reject rule can't be fixed without LLM rewrite.
      // On the second reviewer pass (after rewriteNode forced exhaustion),
      // the hard_reject fires again, setting requires_human=true,
      // which causes confidenceGate to route to handoff.
      expect(data.route).toBe("human_handoff");
    });
  });

  // ───────────────────────────────────────────────
  // 7. Reviewer trace metadata
  // ───────────────────────────────────────────────
  describe("reviewer trace metadata", () => {
    it("reviewer trace includes score and flags", async () => {
      const input = makeChatInput({
        text: "你好",
        tenantConfig: { confidenceThreshold: 0 },
      } as any);

      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);

      const reviewerTrace = (data.trace as any[]).find((t: any) => t.node === "reviewer");
      expect(reviewerTrace).toBeDefined();
      expect(reviewerTrace.metadata).toBeDefined();
      expect(typeof reviewerTrace.metadata.score).toBe("number");
      expect(Array.isArray(reviewerTrace.metadata.flags)).toBe(true);
      expect(typeof reviewerTrace.metadata.method).toBe("string");
    });
  });

  // ───────────────────────────────────────────────
  // 8. Backward compatibility
  // ───────────────────────────────────────────────
  describe("backward compatibility", () => {
    it("no reviewerPolicy — behaves like original reviewer", async () => {
      const input = makeChatInput({
        text: "你好",
        tenantConfig: {},
      } as any);

      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);
      // Should complete normally
      expect(typeof data.reply).toBe("string");
      expect(data.reply.length).toBeGreaterThan(0);
      // No rewriter in trace
      const traceNodes = (data.trace as any[]).map((t: any) => t.node);
      expect(traceNodes).not.toContain("rewriter");
    });

    it("no tenantConfig at all — still works", async () => {
      const input = makeChatInput({ text: "你好" });

      const { status, data } = await postChat(srv.baseUrl, input);
      expect(status).toBe(200);
      expect(typeof data.reply).toBe("string");
    });
  });

  // ───────────────────────────────────────────────
  // 9. Penalty score impact
  // ───────────────────────────────────────────────
  describe("penalty score impact", () => {
    it("penalty rule reduces confidence score", async () => {
      // First get baseline confidence without custom rules
      const baseline = await postChat(srv.baseUrl, makeChatInput({
        text: "你好",
        tenantConfig: { confidenceThreshold: 0 },
      } as any));

      // Then with a penalty rule that matches the heuristic reply template
      const withPenalty = await postChat(srv.baseUrl, makeChatInput({
        text: "你好",
        tenantConfig: {
          confidenceThreshold: 0,
          reviewerPolicy: {
            customRules: [
              {
                id: "rule_score_test",
                name: "Penalize confirm word",
                type: "keyword" as const,
                mode: "must_not_contain" as const,
                pattern: ["确认", "信息"],
                action: "penalty" as const,
                penaltyScore: -0.3,
                enabled: true,
              },
            ],
          },
        },
      } as any));

      expect(baseline.status).toBe(200);
      expect(withPenalty.status).toBe(200);
      // Confidence should be lower with the penalty
      expect(withPenalty.data.confidence).toBeLessThan(baseline.data.confidence);
    });
  });
});
