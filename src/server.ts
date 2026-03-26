import "./config/env";
import { createAliceServer } from "./app";
import { logger } from "./logger";
import { createSessionStore, closeSessionStore } from "./sessionStore";
import { startRequestWorker, stopWorker } from "./queues/worker";

const PORT = Number(process.env.PORT ?? 3000);

// Initialize session store (Redis if REDIS_URL set, otherwise in-memory)
createSessionStore(process.env.REDIS_URL);

// Start BullMQ worker to consume request queue
startRequestWorker();

// HTTP server for health checks + legacy /v1/chat endpoint
const server = createAliceServer();
server.listen(PORT, () => {
  logger.info({ port: PORT }, "alice server listening");
});

const shutdown = async (): Promise<void> => {
  await stopWorker();
  await closeSessionStore();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
