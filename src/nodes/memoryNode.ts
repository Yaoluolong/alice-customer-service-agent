import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { extractPreferences, vikingClient } from "../mocks/openviking";
import { AgentState, UserPreference } from "../types";

const dedupePreferences = (preferences: UserPreference[]): UserPreference[] => {
  const seen = new Set<string>();
  const output: UserPreference[] = [];
  for (const preference of preferences) {
    const key = `${preference.key}:${JSON.stringify(preference.value)}`;
    if (!seen.has(key)) {
      seen.add(key);
      output.push(preference);
    }
  }
  return output;
};

const getLastUserText = (messages: BaseMessage[]): string => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i] instanceof HumanMessage) {
      return String(messages[i].content ?? "");
    }
  }
  return "";
};

const buildConversationSummary = (messages: BaseMessage[]): string => {
  const lines = messages
    .filter((message) => message instanceof HumanMessage || message instanceof AIMessage)
    .slice(-6)
    .map((message) => `${message instanceof HumanMessage ? "user" : "assistant"}: ${String(message.content).slice(0, 120)}`);
  return lines.join("\n");
};

export const memoryBootstrapNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  const history = await vikingClient.searchContext(state.user_id, "preference style summary", 5);
  const prefs = await vikingClient.getUserPreferences(state.user_id);
  const styleProfile = await vikingClient.getUserStyleProfile(state.user_id);

  const summaryEntry = history
    .filter((item) => item.category === "conversation:summary")
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];

  return {
    user_preferences: prefs,
    style_profile: styleProfile ?? state.style_profile,
    conversation_summary: summaryEntry?.content ?? state.conversation_summary,
    trace: [`memory:bootstrap=${history.length}`]
  };
};

export const memoryPersistNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  const latestText = getLastUserText(state.messages);
  const extracted = extractPreferences(latestText);
  const mergedPrefs = dedupePreferences([...state.user_preferences, ...extracted]);
  const summary = buildConversationSummary(state.messages);

  await vikingClient.addContext({
    userId: state.user_id,
    sessionId: state.session_id,
    messages: state.messages
      .filter((message) => message instanceof HumanMessage || message instanceof AIMessage)
      .map((message) => ({
        role: message instanceof HumanMessage ? "user" : "assistant",
        content: String(message.content)
      })),
    preferences: mergedPrefs,
    styleProfile: state.style_profile,
    conversationSummary: summary
  });

  return {
    user_preferences: mergedPrefs,
    conversation_summary: summary,
    trace: [`memory:persist=${mergedPrefs.length}`]
  };
};
