import assert from "node:assert/strict";
import { parseAgentConfig } from "../config/env";

export const runEnvTests = (): void => {
  const baseEnv: NodeJS.ProcessEnv = {
    OPENAI_PRIMARY_MODEL: "gpt-main",
    OPENAI_AUX_MODEL: "gpt-aux"
  };

  const config = parseAgentConfig(baseEnv);
  assert.equal(config.openai.primaryModel, "gpt-main");
  assert.equal(config.openai.auxModel, "gpt-aux");
  assert.equal(config.confidence.threshold, 0.7);
  assert.equal(config.language.defaultReplyLanguage, "zh-CN");
  assert.equal(config.runtime.llmTimeoutMs, 45000);

  const capped = parseAgentConfig({ OPENAI_PRIMARY_MODEL: "gpt-main", AGENT_CONFIDENCE_THRESHOLD: "2" });
  assert.equal(capped.confidence.threshold, 1);

  const lowered = parseAgentConfig({ OPENAI_PRIMARY_MODEL: "gpt-main", AGENT_CONFIDENCE_THRESHOLD: "-1" });
  assert.equal(lowered.confidence.threshold, 0);

  const fixedLanguage = parseAgentConfig({
    OPENAI_PRIMARY_MODEL: "gpt-main",
    DEFAULT_REPLY_LANGUAGE: "en-US",
    LANGUAGE_POLICY: "fixed",
    SUPPORTED_LANGUAGES: "en-US,zh-CN"
  });
  assert.equal(fixedLanguage.language.policy, "fixed");
  assert.equal(fixedLanguage.language.defaultReplyLanguage, "en-US");
};
