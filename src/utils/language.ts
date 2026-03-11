import { BaseMessage } from "@langchain/core/messages";
import { appConfig, LanguagePolicy } from "../config/env";
import { getRecentUserTexts } from "./messages";

const containsChinese = (text: string): boolean => /[\u4e00-\u9fff]/.test(text);
const containsAsciiWord = (text: string): boolean => /[a-zA-Z]{2,}/.test(text);

export const inferLanguageFromText = (text: string): string | null => {
  if (!text || text.trim().length === 0) return null;
  if (containsChinese(text)) return "zh-CN";
  if (containsAsciiWord(text)) return "en-US";
  return null;
};

export const resolveReplyLanguage = (
  messages: BaseMessage[],
  options?: {
    policy?: LanguagePolicy;
    defaultLanguage?: string;
    supportedLanguages?: string[];
  }
): string => {
  const policy = options?.policy ?? appConfig.language.policy;
  const defaultLanguage = options?.defaultLanguage ?? appConfig.language.defaultReplyLanguage;
  const supported = options?.supportedLanguages ?? appConfig.language.supportedLanguages;

  if (policy === "fixed") {
    return supported.includes(defaultLanguage) ? defaultLanguage : supported[0] ?? "zh-CN";
  }

  const recentTexts = getRecentUserTexts(messages, 2);
  for (let i = recentTexts.length - 1; i >= 0; i -= 1) {
    const inferred = inferLanguageFromText(recentTexts[i]);
    if (inferred && supported.includes(inferred)) {
      return inferred;
    }
  }

  return supported.includes(defaultLanguage) ? defaultLanguage : supported[0] ?? "zh-CN";
};
