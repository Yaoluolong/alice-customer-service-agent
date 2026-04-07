import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { MessagePart } from "../clients/openviking-client";
import { resolveOvClient } from "../clients/resolve-ov-client";
import { logger } from "../logger";
import { AgentState, MemoryContext, SearchItem } from "../types";

const MESSAGE_COMMIT_THRESHOLD = 20;

const getLastUserText = (state: AgentState): string => {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    if (state.messages[i] instanceof HumanMessage) {
      return String(state.messages[i].content ?? "");
    }
  }
  return "";
};

const buildConversationSummary = (messages: Array<{ role: string; content: string }>): string =>
  messages
    .slice(-6)
    .map((m) => `${m.role}: ${m.content.slice(0, 120)}`)
    .join("\n");

export const categoriseMemories = (
  items: SearchItem[]
): Pick<MemoryContext["longTerm"], "profile" | "preferences" | "entities" | "events" | "cases" | "patterns"> => {
  let profile: string | null = null;
  const preferences: SearchItem[] = [];
  const entities: SearchItem[] = [];
  const events: SearchItem[] = [];
  const cases: SearchItem[] = [];
  const patterns: SearchItem[] = [];

  for (const item of items) {
    const uriLower = item.uri.toLowerCase();
    const absLower = (item.abstract ?? "").toLowerCase();

    if (uriLower.includes("profile") || absLower.includes("profile")) {
      if (!profile) profile = item.abstract || item.uri;
    } else if (uriLower.includes("pattern")) {
      patterns.push(item);
    } else if (uriLower.includes("case")) {
      cases.push(item);
    } else if (uriLower.includes("preference") || absLower.includes("prefer")) {
      preferences.push(item);
    } else if (
      uriLower.includes("entit") ||
      absLower.includes("product") ||
      absLower.includes("brand")
    ) {
      entities.push(item);
    } else if (
      uriLower.includes("event") ||
      uriLower.includes("purchase") ||
      uriLower.includes("order") ||
      uriLower.includes("milestone")
    ) {
      events.push(item);
    } else {
      preferences.push(item);
    }
  }

  return { profile, preferences, entities, events, cases, patterns };
};

export const memoryBootstrapNode = async (state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> => {
  const openVikingClient = resolveOvClient(config);
  const { tenant_id, customer_id } = state;
  let ovSessionId = state.openviking_session_id;
  let ovMessageCount = state.openviking_message_count ?? 0;

  // 1. Get or create OpenViking session
  if (!ovSessionId) {
    try {
      const sessions = await openVikingClient.listSessions(tenant_id, customer_id);
      const active = sessions
        .filter((s) => s.status !== "archived" && s.status !== "committed")
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0];

      if (active) {
        ovSessionId = active.session_id;
        ovMessageCount = active.message_count ?? 0;
      } else {
        const created = await openVikingClient.createSession(tenant_id, customer_id);
        ovSessionId = created.session_id;
        ovMessageCount = 0;
      }
    } catch (err) {
      // Non-fatal: continue without persistent session
      ovSessionId = `local_${Date.now()}`;
      ovMessageCount = 0;
    }
  }

  // 2. Load long-term memories via dual-query: contextual + baseline profile
  const userQuery = getLastUserText(state);
  const baselineQuery = "user profile preferences history milestone purchases";

  const CONTEXTUAL_LIMIT = 70;
  const BASELINE_LIMIT = 30;

  let longTermItems: SearchItem[] = [];
  try {
    const ovSession = ovSessionId?.startsWith("local_") ? undefined : ovSessionId ?? undefined;

    const [contextualResult, baselineResult] = await Promise.allSettled([
      openVikingClient.search(
        tenant_id, customer_id,
        userQuery || baselineQuery,
        ovSession,
        "viking://user/memories/",
        CONTEXTUAL_LIMIT
      ),
      openVikingClient.search(
        tenant_id, customer_id,
        baselineQuery,
        ovSession,
        "viking://user/memories/",
        BASELINE_LIMIT
      ),
    ]);

    const seenUris = new Set<string>();
    const collect = (result: PromiseSettledResult<Awaited<ReturnType<typeof openVikingClient.search>>>) => {
      if (result.status !== "fulfilled") return;
      for (const item of [...(result.value.memories ?? []), ...(result.value.resources ?? [])]) {
        if (!seenUris.has(item.uri)) {
          seenUris.add(item.uri);
          longTermItems.push(item);
        }
      }
    };

    collect(contextualResult);
    collect(baselineResult);

    // Both failed — fall back to findMemories
    if (longTermItems.length === 0 && contextualResult.status === "rejected" && baselineResult.status === "rejected") {
      const fallback = await openVikingClient.findMemories(
        tenant_id, customer_id,
        userQuery || baselineQuery,
        "viking://user/memories/",
        100
      );
      longTermItems = [...(fallback.memories ?? []), ...(fallback.resources ?? [])];
    }

    longTermItems.sort((a, b) => b.score - a.score);
  } catch {
    // Non-fatal: proceed without long-term memories
  }

  const { profile, preferences, entities, events, cases, patterns } = categoriseMemories(longTermItems);

  // 3. Build short-term from existing messages in state
  const recentMessages = state.messages
    .filter((m) => m instanceof HumanMessage || m instanceof AIMessage)
    .slice(-10)
    .map((m) => ({
      role: m instanceof HumanMessage ? "user" : "assistant",
      content: String(m.content).slice(0, 200)
    }));

  const sessionSummaries = recentMessages.length > 0 ? [buildConversationSummary(recentMessages)] : [];

  const memoryContext: MemoryContext = {
    shortTerm: { recentMessages, sessionSummaries },
    longTerm: { profile, preferences, entities, events, cases, patterns }
  };

  // Extract style profile hint from long-term if available
  const profileText = profile ?? "";
  const existingStyle = state.style_profile;

  return {
    openviking_session_id: ovSessionId,
    openviking_message_count: ovMessageCount,
    memory_context: memoryContext,
    conversation_summary: sessionSummaries[0] ?? state.conversation_summary,
    style_profile: existingStyle,
    trace: [`memory:bootstrap=session:${ovSessionId},lt:${longTermItems.length}`]
  };
};

export const memoryPersistNode = async (state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> => {
  const openVikingClient = resolveOvClient(config);
  const { tenant_id, customer_id, openviking_session_id } = state;

  if (!openviking_session_id || openviking_session_id.startsWith("local_")) {
    return {
      openviking_message_count: 0,
      trace: ["memory:persist=skipped(no-session)"]
    };
  }

  // Get last user message and last assistant message
  const allMessages = state.messages;
  let lastUser: string | null = null;
  let lastAssistant: string | null = null;

  for (let i = allMessages.length - 1; i >= 0; i--) {
    const msg = allMessages[i];
    if (!lastAssistant && msg instanceof AIMessage) {
      lastAssistant = String(msg.content);
    } else if (!lastUser && msg instanceof HumanMessage) {
      lastUser = String(msg.content);
    }
    if (lastUser && lastAssistant) break;
  }

  let persistedMessages = 0;

  try {
    // Save user message
    if (lastUser) {
      const userParts = [{ type: "text" as const, text: lastUser }];

      // If there was media with a description, add context part
      if (state.media_context?.description) {
        userParts.push({
          type: "context" as const,
          uri: `media://${state.media_context.mediaId}`,
          abstract: state.media_context.description.slice(0, 200)
        } as any);
      }

      await openVikingClient.addMessage(tenant_id, customer_id, openviking_session_id, "user", userParts);
      persistedMessages += 1;
    }

    // Save assistant reply with ContextParts from grounding facts
    if (lastAssistant) {
      const assistantParts: MessagePart[] = [{ type: "text", text: lastAssistant }];

      const usedUris: string[] = [];
      if (state.grounding_facts?.facts) {
        for (const fact of state.grounding_facts.facts) {
          if (fact.sourceUri && fact.sourceUri.startsWith("viking://")) {
            assistantParts.push({
              type: "context",
              uri: fact.sourceUri,
              context_type: "resource",
              abstract: fact.value.slice(0, 200)
            });
            usedUris.push(fact.sourceUri);
          }
        }
      }

      await openVikingClient.addMessage(
        tenant_id,
        customer_id,
        openviking_session_id,
        "assistant",
        assistantParts
      );
      persistedMessages += 1;

      // Report used contexts (non-blocking)
      if (usedUris.length > 0) {
        openVikingClient
          .sessionUsed(tenant_id, customer_id, openviking_session_id, [...new Set(usedUris)])
          .catch((err) => {
            logger.warn({ tenant_id, customer_id, err: err.message }, "memory-persist sessionUsed failed");
          });
      }
    }

    const nextMessageCount = (state.openviking_message_count ?? 0) + persistedMessages;
    if (nextMessageCount >= MESSAGE_COMMIT_THRESHOLD) {
      openVikingClient
        .commitSession(tenant_id, customer_id, openviking_session_id, false)
        .catch((err) => {
          logger.warn({ tenant_id, openviking_session_id, err: err.message }, "memory-persist commitSession failed");
        });

      return {
        openviking_session_id: null,
        openviking_message_count: 0,
        trace: [`memory:persist=ok,commit@${nextMessageCount}`]
      };
    }
  } catch {
    // Non-fatal: persist failure doesn't break the response
    return {
      openviking_message_count: state.openviking_message_count ?? 0,
      trace: ["memory:persist=error"]
    };
  }

  return {
    openviking_message_count: (state.openviking_message_count ?? 0) + persistedMessages,
    trace: [`memory:persist=ok,+${persistedMessages}`]
  };
};
