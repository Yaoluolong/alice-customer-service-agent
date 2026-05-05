import { runConfidenceGateTests } from "./confidenceGate.test";
import { runEnvTests } from "./env.test";
import { runLanguageTests } from "./language.test";

const main = async (): Promise<void> => {
  runEnvTests();
  runLanguageTests();
  await runConfidenceGateTests();
  console.log("[tests] all checks passed");
};

main().catch((error: unknown) => {
  console.error("[tests] failed", error);
  process.exitCode = 1;
});
