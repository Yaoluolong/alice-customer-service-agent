// Global setup: set env vars before any test workers start.
// OPENAI_API_KEY="" forces getConfiguredModel() to return null,
// so all nodes fall back to heuristic paths (deterministic, no LLM calls).
export const setup = async (): Promise<void> => {
  process.env.OPENAI_API_KEY = "";
  process.env.OPENAI_PRIMARY_MODEL = "test-model";
  process.env.OPENAI_AUX_MODEL = "test-model";
  process.env.OPENVIKING_BASE_URL = "http://openviking-mock.test";
  process.env.OPENVIKING_API_KEY = "test-ov-key";
  // Set threshold=0 so heuristic reviewer (no LLM, score≈0.30) never triggers
  // handoff via confidence. UNKNOWN intent still triggers handoff via router.
  process.env.AGENT_CONFIDENCE_THRESHOLD = "0";
  process.env.LOG_LEVEL = "silent";
  process.env.DEFAULT_REPLY_LANGUAGE = "zh-CN";
  // Disable system proxy so nock interceptors work correctly
  process.env.HTTP_PROXY = "";
  process.env.HTTPS_PROXY = "";
  process.env.http_proxy = "";
  process.env.https_proxy = "";
  process.env.NO_PROXY = "*";
  process.env.no_proxy = "*";
};

export const teardown = async (): Promise<void> => {
  // nothing to clean up
};

export default setup;
