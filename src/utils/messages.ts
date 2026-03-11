import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";

export const getLastUserText = (messages: BaseMessage[]): string => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i] instanceof HumanMessage) {
      return String(messages[i].content ?? "");
    }
  }
  return "";
};

export const getRecentUserTexts = (messages: BaseMessage[], limit: number): string[] => {
  const output: string[] = [];
  for (let i = messages.length - 1; i >= 0 && output.length < limit; i -= 1) {
    if (messages[i] instanceof HumanMessage) {
      output.unshift(String(messages[i].content ?? ""));
    }
  }
  return output;
};

export const getRecentConversationWindow = (messages: BaseMessage[], maxMessages: number): BaseMessage[] => {
  if (messages.length <= maxMessages) return messages;
  return messages.slice(messages.length - maxMessages);
};

export const getLastAssistantText = (messages: BaseMessage[]): string => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i] instanceof AIMessage) {
      return String(messages[i].content ?? "");
    }
  }
  return "";
};
