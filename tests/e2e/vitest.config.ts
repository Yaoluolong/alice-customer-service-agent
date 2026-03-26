import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globalSetup: resolve(__dirname, "setup.ts"),
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: "forks",
    include: [resolve(__dirname, "**/*.test.ts")],
    reporters: ["verbose"]
  }
});
