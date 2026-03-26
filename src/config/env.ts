import "dotenv/config";

export type LanguagePolicy = "auto" | "fixed";

export interface AgentConfig {
  openai: {
    apiKey: string | null;
    baseUrl: string | null;
    primaryModel: string;
    auxModel: string;
  };
  openviking: {
    baseUrl: string;
    apiKey: string | null;
  };
  confidence: {
    threshold: number;
  };
  language: {
    defaultReplyLanguage: string;
    policy: LanguagePolicy;
    supportedLanguages: string[];
  };
  runtime: {
    maxConversationMessages: number;
    llmTimeoutMs: number;
  };
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const parseCsv = (raw: string | undefined, fallback: string[]): string[] => {
  if (!raw || raw.trim().length === 0) return fallback;
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return entries.length > 0 ? entries : fallback;
};

const parseLanguagePolicy = (raw: string | undefined): LanguagePolicy => {
  if (!raw) return "auto";
  const normalized = raw.trim().toLowerCase();
  if (normalized === "fixed") return "fixed";
  return "auto";
};

const parseThreshold = (raw: string | undefined): number => {
  if (!raw || raw.trim().length === 0) return 0.7;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 0.7;
  return clamp(parsed, 0, 1);
};

const parseMaxConversationMessages = (raw: string | undefined): number => {
  if (!raw || raw.trim().length === 0) return 12;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return 12;
  return clamp(parsed, 6, 40);
};

const parseLlmTimeoutMs = (raw: string | undefined): number => {
  if (!raw || raw.trim().length === 0) return 45000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1000) return 45000;
  return clamp(parsed, 1000, 120000);
};

export const parseAgentConfig = (env: NodeJS.ProcessEnv): AgentConfig => {
  const apiKey = env.OPENAI_API_KEY?.trim() ?? "";
  const baseUrl = env.OPENAI_BASE_URL?.trim() ?? "";
  const primaryModel = (env.OPENAI_PRIMARY_MODEL?.trim() ?? env.OPENAI_MODEL?.trim() ?? "").trim();

  if (!primaryModel) {
    throw new Error("OPENAI_PRIMARY_MODEL is required");
  }

  const auxModel = (env.OPENAI_AUX_MODEL?.trim() ?? "").trim() || primaryModel;
  const policy = parseLanguagePolicy(env.LANGUAGE_POLICY);
  const defaultReplyLanguage = (env.DEFAULT_REPLY_LANGUAGE?.trim() ?? "zh-CN") || "zh-CN";
  const supportedLanguages = parseCsv(env.SUPPORTED_LANGUAGES, ["zh-CN", "en-US"]);
  const normalizedSupported = supportedLanguages.includes(defaultReplyLanguage)
    ? supportedLanguages
    : [defaultReplyLanguage, ...supportedLanguages];

  const ovBaseUrl = (env.OPENVIKING_BASE_URL?.trim() ?? "http://localhost:1933").replace(/\/+$/, "");
  const ovApiKey = env.OPENVIKING_API_KEY?.trim() ?? "";

  return {
    openai: {
      apiKey: apiKey.length > 0 ? apiKey : null,
      baseUrl: baseUrl.length > 0 ? baseUrl : null,
      primaryModel,
      auxModel
    },
    openviking: {
      baseUrl: ovBaseUrl,
      apiKey: ovApiKey.length > 0 ? ovApiKey : null
    },
    confidence: {
      threshold: parseThreshold(env.AGENT_CONFIDENCE_THRESHOLD)
    },
    language: {
      defaultReplyLanguage,
      policy,
      supportedLanguages: normalizedSupported
    },
    runtime: {
      maxConversationMessages: parseMaxConversationMessages(env.MAX_CONVERSATION_MESSAGES),
      llmTimeoutMs: parseLlmTimeoutMs(env.LLM_TIMEOUT_MS)
    }
  };
};

export const appConfig = parseAgentConfig(process.env);
