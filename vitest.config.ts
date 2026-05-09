import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    include: [resolve(__dirname, "tests/unit/**/*.test.ts")],
    reporters: ["verbose"]
  }
});
