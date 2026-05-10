import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { v4 as uuidv4 } from "uuid";
import { openVikingClient } from "./clients/openviking-client";
import { appConfig } from "./config/env";
import { buildCustomerServiceGraph } from "./graph";
import { logger } from "./logger";
import { getSessionStore } from "./sessionStore";
import { ChatInput, ChatResult, MemoryContext, RouteTarget, UserIntent, createInitialState } from "./types";
import { getRecentConversationWindow } from "./utils/messages";

export const GAP_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

export function shouldCommitOnGap(
  lastTimestamp: number,
  sessionId: string | null
): boolean {
  if (!lastTimestamp || lastTimestamp === 0) return false;
  if (!sessionId || sessionId.startsWith("local_")) return false;
  return Date.now() - lastTimestamp > GAP_THRESHOLD_MS;
}

const app = buildCustomerServiceGraph();

const countMemories = (ctx: MemoryContext | null): number => {
  if (!ctx) return 0;
  return (
    (ctx.shortTerm.recentMessages.length) +
    (ctx.longTerm.profile ? 1 : 0) +
    ctx.longTerm.preferences.length +
    ctx.longTerm.entities.length +
    ctx.longTerm.events.length +
    ctx.longTerm.cases.length +
    ctx.longTerm.patterns.length
  );
};

export class CustomerServiceAgentService {
  async chat(input: ChatInput): Promise<ChatResult> {
    const sessionId = input.sessionId ?? `session_${uuidv4()}`;
    const store = getSessionStore();

    const existing = await store.get(sessionId);
    const userMessage = new HumanMessage(input.text);

    // Time-gap commit: if 30+ minutes since last message, commit old session
    if (existing && shouldCommitOnGap(existing.last_message_timestamp, existing.openviking_session_id)) {
      try {
        await openVikingClient.commitSession(input.tenantId, input.customerId, existing.openviking_session_id!, true);
        logger.info({ sessionId: existing.openviking_session_id, gap: Date.now() - existing.last_message_timestamp }, "time-gap commit");
      } catch (err) {
        logger.warn({ err }, "time-gap commit failed, proceeding with new session");
      }
      existing.openviking_session_id = null;
      existing.openviking_message_count = 0;
      existing.intent_stack = [];
    }

    const invocationState = existing
      ? {
          ...existing,
          user_id: input.userId,
          tenant_id: input.tenantId,
          customer_id: input.customerId,
          tenant_config: input.tenantConfig ?? existing.tenant_config ?? null,
          image_context: input.image ?? null,
          media_context: input.media ?? null,
          messages: getRecentConversationWindow(
            [...existing.messages, userMessage],
            appConfig.runtime.maxConversationMessages
          ),
          user_intent: UserIntent.UNKNOWN,
          requires_human: false,
          grounding_facts: null,
          draft_reply: null,
          tone_applied: null,
          variation_id: null,
          agent_confidence: 1,
          review_flags: [],
          reviewer_retries: 0,
          failed_checks: [],
          retry_feedback: [],
          confidence_reasons: [],
          handoff_reason: null,
          trace: [],
          intent_stack: existing.intent_stack ?? [],
          previous_summary: existing.previous_summary ?? null,
        }
      : createInitialState({
          sessionId,
          userId: input.userId,
          tenantId: input.tenantId,
          customerId: input.customerId,
          userMessage,
          imageContext: input.image,
          mediaContext: input.media,
          replyLanguage: appConfig.language.defaultReplyLanguage,
          tenantConfig: input.tenantConfig
        });

    // Update timestamp for current message
    invocationState.last_message_timestamp = Date.now();

    const finalState = await app.invoke(invocationState);
    await store.set(sessionId, finalState);

    const lastAssistantMessage = [...finalState.messages]
      .reverse()
      .find((message) => message instanceof AIMessage);

    return {
      sessionId,
      reply: String(lastAssistantMessage?.content ?? ""),
      intent: finalState.user_intent,
      route: finalState.requires_human ? RouteTarget.HUMAN_HANDOFF : finalState.route_target,
      productId: finalState.current_product_id,
      trace: finalState.trace,
      preferences: finalState.user_preferences,
      confidence: finalState.agent_confidence,
      handoffReason: finalState.handoff_reason ?? undefined,
      reviewFlags: finalState.review_flags,
      replyLanguage: finalState.reply_language,
      openVikingSessionId: finalState.openviking_session_id ?? "",
      memoriesLoaded: countMemories(finalState.memory_context)
    };
  }

  async getSession(sessionId: string) {
    return getSessionStore().get(sessionId);
  }
}

export const customerServiceAgentService = new CustomerServiceAgentService();
