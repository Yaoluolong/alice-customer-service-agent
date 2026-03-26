import { RunnableConfig } from "@langchain/core/runnables";
import { OpenVikingHttpClient, openVikingClient } from "./openviking-client";

/**
 * Resolve the OpenViking client from LangGraph configurable or fall back to the singleton.
 * Usage in nodes: `const ov = resolveOvClient(config);`
 */
export function resolveOvClient(config?: RunnableConfig): OpenVikingHttpClient {
  const injected = (config?.configurable as Record<string, unknown> | undefined)?.ovClient;
  if (injected && injected instanceof OpenVikingHttpClient) {
    return injected;
  }
  return openVikingClient;
}
