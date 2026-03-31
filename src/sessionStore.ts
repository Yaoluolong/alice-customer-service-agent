import { BaseMessage } from "@langchain/core/messages";
import {
  mapChatMessagesToStoredMessages,
  mapStoredMessagesToChatMessages,
} from "@langchain/core/messages";
import Redis from "ioredis";
import { logger } from "./logger";
import { AgentState } from "./types";

export interface SessionStore {
  get(sessionId: string): Promise<AgentState | null>;
  set(sessionId: string, state: AgentState): Promise<void>;
  merge(sessionId: string, patch: Partial<AgentState>): Promise<AgentState>;
  close?(): Promise<void>;
}

// ── Serialization helpers ──────────────────────────────────────────────────

interface SerializedState {
  /** Everything except messages (plain JSON-safe) */
  data: Omit<AgentState, "messages">;
  /** Messages in langchain StoredMessage format */
  messages: ReturnType<typeof mapChatMessagesToStoredMessages>;
}

const serialize = (state: AgentState): string => {
  const { messages, ...data } = state;
  const payload: SerializedState = {
    data,
    messages: mapChatMessagesToStoredMessages(messages),
  };
  return JSON.stringify(payload);
};

const deserialize = (raw: string): AgentState => {
  const payload: SerializedState = JSON.parse(raw);
  const messages = mapStoredMessagesToChatMessages(payload.messages);
  return { ...payload.data, messages } as AgentState;
};

// ── Redis Session Store ────────────────────────────────────────────────────

const KEY_PREFIX = "alice:session:";
const DEFAULT_TTL_SECONDS = 24 * 60 * 60; // 24 hours

/**
 * Lua script for atomic merge: read → merge → write in a single round-trip.
 * KEYS[1] = session key
 * ARGV[1] = JSON patch (SerializedState of the patch)
 * ARGV[2] = TTL in seconds
 * Returns the merged state JSON, or nil if key doesn't exist.
 */
const MERGE_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end

local ok, existing = pcall(cjson.decode, raw)
if not ok then return nil end

local ok2, patch = pcall(cjson.decode, ARGV[1])
if not ok2 then return nil end

-- Merge data fields (patch.data overrides existing.data)
for k, v in pairs(patch.data) do
  existing.data[k] = v
end

-- Append patch messages to existing messages
if patch.messages and #patch.messages > 0 then
  for _, m in ipairs(patch.messages) do
    table.insert(existing.messages, m)
  end
end

-- Update timestamp
existing.data.updatedAt = tonumber(ARGV[3]) or 0

local merged = cjson.encode(existing)
redis.call('SET', KEYS[1], merged, 'EX', tonumber(ARGV[2]))
return merged
`;

export class RedisSessionStore implements SessionStore {
  private readonly redis: Redis;
  private readonly ttl: number;

  constructor(redis: Redis, ttl: number = DEFAULT_TTL_SECONDS) {
    this.redis = redis;
    this.ttl = ttl;
  }

  async get(sessionId: string): Promise<AgentState | null> {
    const raw = await this.redis.get(`${KEY_PREFIX}${sessionId}`);
    if (!raw) return null;
    return deserialize(raw);
  }

  async set(sessionId: string, state: AgentState): Promise<void> {
    await this.redis.set(
      `${KEY_PREFIX}${sessionId}`,
      serialize(state),
      "EX",
      this.ttl
    );
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }

  async merge(sessionId: string, patch: Partial<AgentState>): Promise<AgentState> {
    const patchMessages = patch.messages ?? [];
    const { messages: _, ...patchData } = patch;

    const patchPayload: SerializedState = {
      data: patchData as Omit<AgentState, "messages">,
      messages: mapChatMessagesToStoredMessages(patchMessages as BaseMessage[]),
    };

    const result = await this.redis.eval(
      MERGE_LUA,
      1,
      `${KEY_PREFIX}${sessionId}`,
      JSON.stringify(patchPayload),
      String(this.ttl),
      String(Date.now())
    ) as string | null;

    if (!result) {
      throw new Error(`session not found: ${sessionId}`);
    }

    return deserialize(result);
  }
}

// ── In-Memory Session Store (fallback / testing) ───────────────────────────

interface SessionSnapshot {
  state: AgentState;
  updatedAt: number;
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions: Map<string, SessionSnapshot> = new Map();

  async get(sessionId: string): Promise<AgentState | null> {
    return this.sessions.get(sessionId)?.state ?? null;
  }

  async set(sessionId: string, state: AgentState): Promise<void> {
    this.sessions.set(sessionId, { state, updatedAt: Date.now() });
  }

  async merge(sessionId: string, patch: Partial<AgentState>): Promise<AgentState> {
    const existing = await this.get(sessionId);
    if (!existing) {
      throw new Error(`session not found: ${sessionId}`);
    }

    const nextMessages = patch.messages
      ? [...existing.messages, ...patch.messages]
      : existing.messages;

    const nextState: AgentState = {
      ...existing,
      ...patch,
      messages: nextMessages as BaseMessage[],
    };

    await this.set(sessionId, nextState);
    return nextState;
  }
}

class ResilientSessionStore implements SessionStore {
  private readonly primary: RedisSessionStore;
  private readonly fallback: InMemorySessionStore;
  private degraded = false;

  constructor(primary: RedisSessionStore, fallback: InMemorySessionStore = new InMemorySessionStore()) {
    this.primary = primary;
    this.fallback = fallback;
  }

  private async degrade(err: unknown, operation: string): Promise<void> {
    if (!this.degraded) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message, operation }, "session-store Redis unavailable, switching to in-memory mirror");
      this.degraded = true;
    }
  }

  async get(sessionId: string): Promise<AgentState | null> {
    if (this.degraded) {
      return this.fallback.get(sessionId);
    }

    try {
      const state = await this.primary.get(sessionId);
      if (state) {
        await this.fallback.set(sessionId, state);
        return state;
      }
      return this.fallback.get(sessionId);
    } catch (err) {
      await this.degrade(err, "get");
      return this.fallback.get(sessionId);
    }
  }

  async set(sessionId: string, state: AgentState): Promise<void> {
    await this.fallback.set(sessionId, state);

    if (this.degraded) {
      return;
    }

    try {
      await this.primary.set(sessionId, state);
    } catch (err) {
      await this.degrade(err, "set");
    }
  }

  async merge(sessionId: string, patch: Partial<AgentState>): Promise<AgentState> {
    if (this.degraded) {
      return this.fallback.merge(sessionId, patch);
    }

    try {
      const merged = await this.primary.merge(sessionId, patch);
      await this.fallback.set(sessionId, merged);
      return merged;
    } catch (err) {
      await this.degrade(err, "merge");
      return this.fallback.merge(sessionId, patch);
    }
  }

  async close(): Promise<void> {
    await this.primary.close();
  }
}

// ── Factory ────────────────────────────────────────────────────────────────

let _store: SessionStore | null = null;

export function createSessionStore(redisUrl?: string): SessionStore {
  if (_store) return _store;

  if (redisUrl) {
    try {
      const redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: false,
        lazyConnect: true,
      });

      redis.on("error", (err) => {
        logger.error({ err: err.message }, "session-store redis error");
      });

      _store = new ResilientSessionStore(new RedisSessionStore(redis));
      logger.info("session-store using Redis store with in-memory fallback");
      return _store;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "session-store failed to create Redis store, falling back to in-memory");
    }
  }

  _store = new InMemorySessionStore();
  logger.info("session-store using in-memory store");
  return _store;
}

/** Get the singleton store (creates InMemorySessionStore if not initialized) */
export function getSessionStore(): SessionStore {
  if (!_store) {
    _store = new InMemorySessionStore();
  }
  return _store;
}

/** Reset singleton (for testing) */
export function resetSessionStore(): void {
  _store = null;
}

/** Close the singleton store and release resources (call during graceful shutdown) */
export async function closeSessionStore(): Promise<void> {
  if (_store?.close) {
    await _store.close();
  }
  _store = null;
}
