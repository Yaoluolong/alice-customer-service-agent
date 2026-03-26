# Alice — AI Agent Engine

TypeScript/LangGraph.js agent engine for the openEcommerce SaaS platform. Processes inbound customer messages from the `alice-requests` BullMQ queue and returns AI-generated replies via the `alice-replies` queue.

## Graph Flow

Fixed pipeline defined in `src/graph.ts`:

```
memoryBootstrap → router → [visual|sales|order|chat]Agent → responseComposer → responseReviewer → confidenceGate → (humanHandoff | memoryPersist)
```

| Node | Role |
|------|------|
| `memoryBootstrap` | Load short-term (session messages) and long-term (extracted memories) context from OpenViking |
| `router` | Intent classification → route to domain agent (aux model) |
| `visualAgent` | VLM image description + semantic product search |
| `salesAgent` | Preference extraction + product search + inventory facts |
| `orderAgent` | Order status query |
| `chatAgent` | General conversation |
| `responseComposer` | Four-segment natural reply using grounding facts (primary model) |
| `responseReviewer` | Score response on fact consistency, executability, naturalness, repetition; falls back to heuristic scoring on LLM failure |
| `confidenceGate` | Route below-threshold responses to humanHandoff |
| `humanHandoff` | Generate context-aware handoff message |
| `memoryPersist` | Save user + assistant messages to OpenViking; report used context URIs; trigger session commit at 20 turns |

## Running

### As BullMQ Worker (SaaS stack — default)

```bash
# Via Docker Compose (recommended)
docker compose up -d alice

# Directly
cd Alice
npm install
npm run build
node dist/server.ts   # initializes RedisSessionStore → starts BullMQ worker + HTTP server
```

### HTTP Mode (dev/testing)

```bash
cd Alice
npm run dev:server   # ts-node src/server.ts, port 3000
```

## Environment Variables

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `OPENAI_PRIMARY_MODEL` | Yes | — | Must be set; startup fails otherwise |
| `OPENAI_API_KEY` | No | — | Empty string = heuristic fallback (no LLM calls) |
| `OPENAI_BASE_URL` | No | — | OpenAI-compatible endpoint |
| `OPENAI_AUX_MODEL` | No | = primary | Auxiliary model for router/reviewer |
| `OPENVIKING_BASE_URL` | No | `http://localhost:1933` | |
| `OPENVIKING_API_KEY` | No | — | |
| `REDIS_URL` | No | `redis://localhost:6379` | Session store + distributed lock; falls back to in-memory if unset |
| `AGENT_CONFIDENCE_THRESHOLD` | No | `0.7` | 0–1; below threshold → human handoff |
| `DEFAULT_REPLY_LANGUAGE` | No | `zh-CN` | |
| `LANGUAGE_POLICY` | No | `auto` | `auto` / `fixed` |
| `SUPPORTED_LANGUAGES` | No | `zh-CN,en-US` | Comma-separated |
| `MAX_CONVERSATION_MESSAGES` | No | `12` | 6–40 |
| `LLM_TIMEOUT_MS` | No | `45000` | 1000–120000 |
| `LOG_LEVEL` | No | `info` | Pino log level |
| `PORT` | No | `3000` | HTTP server port |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/metrics` | Prometheus metrics |
| POST | `/v1/chat` | Process chat message (internal, called by worker) |
| GET | `/v1/sessions/:id` | Get session state |

## Directory Structure

```
src/
├── server.ts              # Entry: RedisSessionStore → BullMQ worker → HTTP listen
├── app.ts                 # createAliceServer() — http.Server factory
├── service.ts             # CustomerServiceAgentService — session management + graph invocation
├── graph.ts               # LangGraph StateGraph definition
├── types.ts               # AgentState, GroundingFact, ChatInput/ChatResult
├── sessionStore.ts        # RedisSessionStore (24h TTL, Lua merge) + InMemorySessionStore
├── logger.ts              # Pino structured logger
├── metrics.ts             # Prometheus metrics (prom-client)
├── config/
│   ├── env.ts             # parseAgentConfig(process.env) — singleton, requires OPENAI_PRIMARY_MODEL
│   ├── models.ts          # LLM instance factory
│   └── persona.ts         # Prompt builders for router/composer/reviewer
├── clients/
│   ├── openviking-client.ts   # OpenViking HTTP client with cockatiel circuit breaker
│   └── resolve-ov-client.ts   # resolveOvClient(config) — DI via LangGraph configurable
├── nodes/
│   ├── memoryNode.ts      # memoryBootstrapNode + memoryPersistNode
│   ├── router.ts          # Intent classification
│   ├── visualAgent.ts     # VLM + visual search
│   ├── salesAgent.ts      # Product search + inventory
│   ├── orderAgent.ts      # Order status
│   ├── chatAgent.ts       # General conversation
│   ├── responseComposer.ts
│   ├── responseReviewer.ts
│   ├── confidenceGate.ts
│   └── humanHandoff.ts
└── queues/
    └── worker.ts          # BullMQ worker: consume alice-requests → produce alice-replies
```

## Testing

### Unit Tests

```bash
npm test   # ts-node src/tests/run.ts
```

### E2E Tests (no Docker required)

```bash
npm run test:e2e   # Vitest, uses nock to mock OpenViking HTTP
```

E2E tests set `OPENAI_API_KEY=""` and `OPENAI_PRIMARY_MODEL="test-model"` to force heuristic paths (no real LLM calls). OpenViking is mocked via nock on host `openviking-mock.test`.

Key test files in `tests/e2e/`:

| File | Coverage |
|------|----------|
| `health.test.ts` | `/health`, 404, error handling |
| `chat-routing.test.ts` | Intent classification → routing |
| `chat-media.test.ts` | Media messages → visual agent |
| `confidence.test.ts` | Confidence threshold + handoff |
| `session-lifecycle.test.ts` | Session create, resume, query |
