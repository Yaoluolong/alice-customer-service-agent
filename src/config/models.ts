import { ChatOpenAI } from "@langchain/openai";
import { appConfig } from "./env";

type ModelRole = "primary" | "aux";

const modelCache = new Map<string, ChatOpenAI>();

export const getConfiguredModel = (role: ModelRole, temperature: number): ChatOpenAI | null => {
  if (!appConfig.openai.apiKey) return null;

  const modelName = role === "primary" ? appConfig.openai.primaryModel : appConfig.openai.auxModel;
  const cacheKey = `${role}:${temperature.toFixed(2)}`;

  const cached = modelCache.get(cacheKey);
  if (cached) return cached;

  const instance = new ChatOpenAI({
    model: modelName,
    temperature,
    timeout: appConfig.runtime.llmTimeoutMs,
    streaming: false,
    apiKey: appConfig.openai.apiKey,
    configuration: appConfig.openai.baseUrl
      ? {
          baseURL: appConfig.openai.baseUrl
        }
      : undefined
  });

  modelCache.set(cacheKey, instance);
  return instance;
};
