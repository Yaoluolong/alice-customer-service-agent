import { Worker, Queue } from "bullmq";
import axios from "axios";
import Redis from "ioredis";
import { logger } from "../logger";
import { customerServiceAgentService } from "../service";
import { QUEUE_NAMES, RequestJobData, ReplyJobData } from "./types";
import { extractFirstFrame } from "../utils/video-frame";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const CONCURRENCY = Number(process.env.QUEUE_CONCURRENCY ?? "5");
const RATE_LIMIT_MAX = Number(process.env.QUEUE_RATE_LIMIT_PER_MIN ?? "0"); // 0 = no limit

// ── Distributed session lock (Redis) ────────────────────────────────────────

const LOCK_TTL_SECONDS = 120; // auto-expire if holder crashes
const LOCK_RETRY_DELAY_MS = 200;
const LOCK_MAX_RETRIES = 300; // 60s total wait

let lockRedis: Redis | null = null;

function getLockRedis(): Redis {
  if (!lockRedis) {
    lockRedis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: false,
    });
    lockRedis.on("error", (err) => {
      logger.error({ err: err.message }, "session-lock redis error");
    });
  }
  return lockRedis;
}

/**
 * Lua script: release lock only if the value matches (owner check).
 */
const RELEASE_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end
`;

async function acquireSessionLock(lockKey: string, owner: string): Promise<boolean> {
  const redis = getLockRedis();
  for (let i = 0; i < LOCK_MAX_RETRIES; i++) {
    const result = await redis.set(lockKey, owner, "EX", LOCK_TTL_SECONDS, "NX");
    if (result === "OK") return true;
    await new Promise((r) => setTimeout(r, LOCK_RETRY_DELAY_MS));
  }
  return false;
}

async function releaseSessionLock(lockKey: string, owner: string): Promise<void> {
  const redis = getLockRedis();
  await redis.eval(RELEASE_LUA, 1, lockKey, owner);
}

async function withSessionLock(sessionId: string, fn: () => Promise<void>): Promise<void> {
  const lockKey = `alice:lock:${sessionId}`;
  const owner = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

  const acquired = await acquireSessionLock(lockKey, owner);
  if (!acquired) {
    throw new Error(`failed to acquire session lock: ${sessionId} after ${LOCK_MAX_RETRIES} retries`);
  }

  try {
    await fn();
  } finally {
    await releaseSessionLock(lockKey, owner);
  }
}

// ── Reply Queue ─────────────────────────────────────────────────────────────

let replyQueue: Queue<ReplyJobData> | null = null;
let requestWorker: Worker<RequestJobData> | null = null;

export function getReplyQueue(): Queue<ReplyJobData> {
  if (!replyQueue) {
    replyQueue = new Queue<ReplyJobData>(QUEUE_NAMES.REPLIES, {
      connection: { url: REDIS_URL },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 3000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
  }
  return replyQueue;
}

// ── Request Worker ──────────────────────────────────────────────────────────

export function startRequestWorker(): Worker<RequestJobData> {
  if (requestWorker) return requestWorker;

  const workerOpts: ConstructorParameters<typeof Worker>[2] = {
    connection: { url: REDIS_URL },
    concurrency: CONCURRENCY,
  };

  if (RATE_LIMIT_MAX > 0) {
    workerOpts.limiter = {
      max: RATE_LIMIT_MAX,
      duration: 60_000,
    };
  }

  requestWorker = new Worker<RequestJobData>(
    QUEUE_NAMES.REQUESTS,
    async (job) => {
      const { correlationId, tenantId, customerId, userId, sessionId, text, media, agentConfig } = job.data;

      // Distributed session lock ensures sequential processing for same customer
      const lockId = `${tenantId}:${customerId}`;

      await withSessionLock(lockId, async () => {
        // Async media download: if media has URL but no base64, download now
        let resolvedMedia = media ?? undefined;
        if (resolvedMedia?.url && !resolvedMedia.base64Data) {
          try {
            const res = await axios.get(resolvedMedia.url, {
              responseType: "arraybuffer",
              timeout: 30000,
            });
            const contentType = String(res.headers["content-type"] ?? resolvedMedia.mimeType);
            resolvedMedia = {
              ...resolvedMedia,
              base64Data: Buffer.from(res.data as ArrayBuffer).toString("base64"),
              mimeType: contentType.split(";")[0],
            };
          } catch (err) {
            logger.warn({ correlationId, err: (err as Error).message }, "media download failed, proceeding without base64");
          }
        }

        // Extract first frame from video so VLM receives an image, not raw video bytes
        if (resolvedMedia?.mediaType === "video" && resolvedMedia.base64Data) {
          try {
            const videoBuffer = Buffer.from(resolvedMedia.base64Data, "base64");
            const frameBase64 = await extractFirstFrame(videoBuffer);
            resolvedMedia = {
              ...resolvedMedia,
              base64Data: frameBase64,
              mimeType: "image/jpeg",
              // Keep mediaType: "video" so downstream nodes know the original type
            };
          } catch (err) {
            logger.warn({ correlationId, err: (err as Error).message }, "video frame extraction failed, proceeding with raw video data");
          }
        }

        const result = await customerServiceAgentService.chat({
          correlationId,
          tenantId,
          customerId,
          userId,
          sessionId,
          text,
          media: resolvedMedia,
          tenantConfig: agentConfig as import("../types").TenantAgentConfig | undefined,
        });

        const isHandoff = !!result.handoffReason || result.route === "human_handoff";

        await getReplyQueue().add("reply", {
          correlationId,
          tenantId,
          customerId,
          reply: result.reply,
          intent: result.intent,
          confidence: result.confidence,
          handoff: isHandoff,
          handoffReason: result.handoffReason,
        });
      });
    },
    workerOpts
  );

  requestWorker.on("failed", (job, err) => {
    const cid = job?.data?.correlationId ?? "unknown";
    logger.error({ correlationId: cid, jobId: job?.id, err }, "alice-worker job failed");
  });

  requestWorker.on("ready", () => {
    logger.info({ queue: QUEUE_NAMES.REQUESTS, concurrency: CONCURRENCY }, "alice-worker listening");
  });

  return requestWorker;
}

export async function stopWorker(): Promise<void> {
  if (requestWorker) {
    await requestWorker.close();
    requestWorker = null;
  }
  if (replyQueue) {
    await replyQueue.close();
    replyQueue = null;
  }
  if (lockRedis) {
    await lockRedis.quit();
    lockRedis = null;
  }
}
