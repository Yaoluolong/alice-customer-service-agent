import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { v4 as uuidv4 } from "uuid";
import { appConfig } from "./config/env";
import { buildCustomerServiceGraph } from "./graph";
import { getSessionStore } from "./sessionStore";
import { ChatInput, ChatResult, MemoryContext, RouteTarget, UserIntent, createInitialState } from "./types";
import { getRecentConversationWindow } from "./utils/messages";

const app = buildCustomerServiceGraph();

const countMemories = (ctx: MemoryContext | null): number => {
  if (!ctx) return 0;
  return (
    (ctx.shortTerm.recentMessages.length) +
    (ctx.longTerm.profile ? 1 : 0) +
    ctx.longTerm.preferences.length +
    ctx.longTerm.entities.length +
    ctx.longTerm.events.length
  );
};

export class CustomerServiceAgentService {
  async chat(input: ChatInput): Promise<ChatResult> {
    const sessionId = input.sessionId ?? `session_${uuidv4()}`;
    const store = getSessionStore();

    const existing = await store.get(sessionId);
    const userMessage = new HumanMessage(input.text);

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
          confidence_reasons: [],
          handoff_reason: null,
          trace: []
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
