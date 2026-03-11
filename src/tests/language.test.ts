import assert from "node:assert/strict";
import { HumanMessage } from "@langchain/core/messages";
import { resolveReplyLanguage } from "../utils/language";

export const runLanguageTests = (): void => {
  const zhMessages = [new HumanMessage("你好，帮我查下这个订单")];
  const enMessages = [new HumanMessage("Can you help me track my order?")];

  assert.equal(
    resolveReplyLanguage(zhMessages, {
      policy: "auto",
      defaultLanguage: "en-US",
      supportedLanguages: ["zh-CN", "en-US"]
    }),
    "zh-CN"
  );

  assert.equal(
    resolveReplyLanguage(enMessages, {
      policy: "auto",
      defaultLanguage: "zh-CN",
      supportedLanguages: ["zh-CN", "en-US"]
    }),
    "en-US"
  );

  assert.equal(
    resolveReplyLanguage(enMessages, {
      policy: "fixed",
      defaultLanguage: "zh-CN",
      supportedLanguages: ["zh-CN", "en-US"]
    }),
    "zh-CN"
  );
};
