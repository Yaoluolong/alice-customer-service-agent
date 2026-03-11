import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { v4 as uuidv4 } from "uuid";
import { appConfig } from "./config/env";
import { buildCustomerServiceGraph } from "./graph";
import { sessionStore } from "./sessionStore";
import { ChatInput, ChatResult, RouteTarget, UserIntent, createInitialState } from "./types";
import { getRecentConversationWindow } from "./utils/messages";

const app = buildCustomerServiceGraph();

export class CustomerServiceAgentService {
  async chat(input: ChatInput): Promise<ChatResult> {
    const sessionId = input.sessionId ?? `session_${uuidv4()}`;

    const existing = sessionStore.get(sessionId);
    const userMessage = new HumanMessage(input.text);

    const invocationState = existing
      ? {
          ...existing,
          user_id: input.userId,
          image_context: input.image ?? null,
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
          userMessage,
          imageContext: input.image,
          replyLanguage: appConfig.language.defaultReplyLanguage
        });

    const finalState = await app.invoke(invocationState);
    sessionStore.set(sessionId, finalState);

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
      replyLanguage: finalState.reply_language
    };
  }

  getSession(sessionId: string) {
    return sessionStore.get(sessionId);
  }
}

export const customerServiceAgentService = new CustomerServiceAgentService();
