import { ChatOpenAI } from "@langchain/openai";
import { appConfig } from "./env";

type ModelRole = "primary" | "aux";

const REASONING_MODEL_PREFIXES = ["o1", "o3", "o4"];

const isReasoningModel = (model: string): boolean =>
  REASONING_MODEL_PREFIXES.some((p) => model.startsWith(p));

const modelCache = new Map<string, ChatOpenAI>();

export const getConfiguredModel = (role: ModelRole, temperature: number): ChatOpenAI | null => {
  if (!appConfig.openai.apiKey) return null;

  const modelName = role === "primary" ? appConfig.openai.primaryModel : appConfig.openai.auxModel;
  const effectiveTemp = isReasoningModel(modelName) ? 1 : temperature;
  const cacheKey = `${role}:${effectiveTemp.toFixed(2)}`;

  const cached = modelCache.get(cacheKey);
  if (cached) return cached;

  const instance = new ChatOpenAI({
    model: modelName,
    temperature: effectiveTemp,
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
