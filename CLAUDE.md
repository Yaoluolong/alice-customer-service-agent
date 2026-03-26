# CLAUDE.md — Alice

AI Agent 引擎，基于 LangGraph.js。接收 Gateway 转发的客户消息，经过多步图流水线处理后返回回复。

## Commands

```bash
npm install
npm run dev          # ts-node src/index.ts (CLI 模式)
npm run dev:server   # ts-node src/server.ts (HTTP 模式，端口 3000)
npm run build        # tsc → dist/
npm test             # ts-node src/tests/run.ts (单元测试)
npm run test:e2e     # vitest run (E2E 测试，不需要 Docker)
```

## Architecture

### Graph Flow

固定链式流水线，定义在 `src/graph.ts`：

```
memoryBootstrap → router → [visual|sales|order|chat]Agent → responseComposer → responseReviewer → confidenceGate → (humanHandoff | memoryPersist)
```

- `visual_agent → sales_agent` 串联（图搜后查库存）
- `confidenceGate` 决定是继续回复（→ memoryPersist）还是转人工（→ humanHandoff → memoryPersist）

### Key Files

| File | Purpose |
|------|---------|
| `src/types.ts` | `AgentState`、`GroundingFact`、`ChatInput`/`ChatResult` 等核心类型。`ChatInput` 包含可选 `correlationId` |
| `src/graph.ts` | LangGraph `StateGraph` 定义、`AgentStateAnnotation`、`buildCustomerServiceGraph()` |
| `src/service.ts` | `CustomerServiceAgentService` — 异步会话管理（`await store.get/set`）、调用 graph、返回 `ChatResult` |
| `src/app.ts` | `createAliceServer()` — 原生 `http.Server`，路由 `/health`、`/metrics`、`/v1/chat`、`/v1/sessions/:id` |
| `src/server.ts` | 入口：初始化 `RedisSessionStore` → `startRequestWorker()` → `createAliceServer().listen(PORT)` |
| `src/config/env.ts` | `parseAgentConfig(process.env)` — 模块加载时解析配置（singleton），要求 `OPENAI_PRIMARY_MODEL` |
| `src/config/models.ts` | `getConfiguredModel()` — LLM 实例工厂 |
| `src/clients/openviking-client.ts` | OpenViking HTTP 客户端（带断路器），`search()`、`find()`、`sessionUsed()` 等 |
| `src/clients/resolve-ov-client.ts` | `resolveOvClient(config)` — 从 LangGraph `configurable` 获取注入的 OV client 或 fallback 到单例 |
| `src/sessionStore.ts` | `RedisSessionStore`（Redis 存储，Lua 原子 merge，24h TTL）+ `InMemorySessionStore`（fallback） |
| `src/logger.ts` | Pino 结构化日志（`logger` + `childLogger(ctx)`） |
| `src/metrics.ts` | Prometheus 指标定义（`prom-client`） |

### Node Files (`src/nodes/`)

| Node | Role |
|------|------|
| `memoryNode.ts` | `memoryBootstrapNode`（加载记忆）+ `memoryPersistNode`（保存消息 + ContextPart + used()）。接受 `RunnableConfig` 用于 OV client DI |
| `router.ts` | 意图分类 → 路由到目标 agent |
| `visualAgent.ts` | VLM 描述 + `search()` 图搜商品。接受 `RunnableConfig` 用于 OV client DI |
| `salesAgent.ts` | 偏好提取 + `search()` 商品搜索 + 库存查询。接受 `RunnableConfig` 用于 OV client DI |
| `orderAgent.ts` | 订单状态查询 |
| `chatAgent.ts` | 通用闲聊 |
| `responseComposer.ts` | 基于 grounding facts 生成回复 |
| `responseReviewer.ts` | 回复审查 + 打分。LLM 审查失败时 **降级到启发式评分**（不再强制转人工） |
| `confidenceGate.ts` | 置信度阈值判断（默认 0.7） |
| `humanHandoff.ts` | 转人工处理 |

### Session Store

`src/sessionStore.ts` 提供 `SessionStore` 接口（`get/set/merge`，全部 async）：

- **`RedisSessionStore`** — 默认。key 前缀 `alice:session:`，24h TTL。`merge` 使用 Lua 脚本保证原子性。`BaseMessage` 序列化使用 `mapChatMessagesToStoredMessages`/`mapStoredMessagesToChatMessages`。
- **`InMemorySessionStore`** — fallback（Redis 不可用时自动降级）。

`server.ts` 启动时调用 `createSessionStore(process.env.REDIS_URL)` 初始化。

### Distributed Session Lock

`src/queues/worker.ts` 使用 Redis 分布式锁（`alice:lock:{tenantId}:{customerId}`）保证同一客户消息顺序处理：
- `SET NX EX` 获取锁（120s TTL 防死锁）
- Lua 脚本原子释放（owner 校验）
- 200ms 重试间隔，最大等待 60s
- 支持多 Alice 实例水平扩展

### BullMQ Worker

`src/queues/worker.ts` 处理流程：
1. 从 `alice-requests` 队列消费
2. 获取分布式会话锁
3. **异步下载媒体**（如有 URL 无 base64）
4. 调用 `customerServiceAgentService.chat()`
5. 将结果入队 `alice-replies`
6. 释放会话锁

队列类型从 `@opencommerce/shared-types` 导入。Payload 包含 `correlationId`，不含 `channelConfig`。

## OpenViking Integration

### 搜索方式

- **`search()`**（首选）— 会话感知搜索，通过 `POST /api/v1/search/search` 传入 `session_id`，OV 利用对话上下文改善搜索质量
- **`findMemories()` / `searchKnowledge()`**（fallback）— 纯向量搜索 `POST /api/v1/search/find`，不带会话上下文

`memoryBootstrapNode` 优先用 `search()`，失败回退到 `findMemories()`。`visualAgent` 和 `salesAgent` 直接用 `search()`。

### 断路器

所有 OpenViking HTTP 调用经 `cockatiel` 断路器保护：
- 连续 5 次失败 → 断路器打开（快速失败）
- 60s 后半开，允许试探性请求
- 状态变化时输出日志

### OV Client 依赖注入

Domain agents（`memoryNode`、`visualAgent`、`salesAgent`）通过 `resolveOvClient(config)` 获取 OV 客户端：
- 优先从 LangGraph `config.configurable.ovClient` 获取（测试/多租户场景）
- Fallback 到全局单例 `openVikingClient`

### ContextPart 与 used()

`memoryPersistNode` 保存 assistant 消息时：
1. 遍历 `grounding_facts.facts`，将有 `sourceUri`（`viking://` 前缀）的 fact 附加为 `ContextPart`
2. 非阻塞调用 `sessionUsed()` 上报实际使用的 context URIs（**失败有日志**）

### Headers

所有 OV 请求携带：
- `X-OpenViking-Account: {tenantId}`
- `X-OpenViking-User: {customerId}`（`search()` / `findMemories()`）
- `X-OpenViking-Agent: alice`

### URI Namespace

- `viking://user/{customerId}/memories/` — 用户长期记忆
- `viking://resources/products/` — 商品知识库

## GroundingFact

```typescript
interface GroundingFact {
  key: string;
  value: string;
  source: "inventory" | "order" | "memory" | "retrieval" | "policy" | "chat";
  confidence: number;
  sourceUri?: string;  // viking:// URI，用于 ContextPart 和 used() 追踪
}
```

Domain agents 在创建 fact 时填充 `sourceUri`（来自搜索结果的 `item.uri`）。

## 可观测性

### Prometheus 指标 (`/metrics`)

基于 `prom-client`，包含：
- `alice_chat_total` — 聊天调用计数（按 tenant_id、route）
- `alice_chat_duration_seconds` — 聊天处理耗时
- `alice_confidence_score` — 置信度分布
- `alice_handoff_total` — 转人工计数
- `alice_openviking_requests_total` — OV 请求计数
- 默认 Node.js 运行时指标

### 结构化日志

使用 Pino（`src/logger.ts`），支持：
- `logger.info/warn/error` — 替代 `console.*`
- `childLogger({ correlationId, tenantId, customerId })` — 带上下文的子日志

## Environment Variables

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `OPENAI_PRIMARY_MODEL` | Yes | — | 必须设置，否则启动报错 |
| `OPENAI_API_KEY` | No | — | 空值 = 走启发式路径（无 LLM） |
| `OPENAI_BASE_URL` | No | — | 兼容 OpenAI API 的端点 |
| `OPENAI_AUX_MODEL` | No | = primary | 辅助模型 |
| `OPENVIKING_BASE_URL` | No | `http://localhost:1933` | |
| `OPENVIKING_API_KEY` | No | — | |
| `REDIS_URL` | No | `redis://localhost:6379` | 用于会话存储和分布式锁。未设置则降级为内存存储 |
| `AGENT_CONFIDENCE_THRESHOLD` | No | `0.7` | 0–1，低于阈值转人工 |
| `DEFAULT_REPLY_LANGUAGE` | No | `zh-CN` | |
| `LANGUAGE_POLICY` | No | `auto` | `auto` / `fixed` |
| `SUPPORTED_LANGUAGES` | No | `zh-CN,en-US` | 逗号分隔 |
| `MAX_CONVERSATION_MESSAGES` | No | `12` | 6–40 |
| `LLM_TIMEOUT_MS` | No | `45000` | 1000–120000 |
| `LOG_LEVEL` | No | `info` | Pino 日志级别 |

## Testing

### E2E Tests (`tests/e2e/`)

- **框架**: Vitest，不需要 Docker
- **环境**: `setup.ts` 设置 `OPENAI_API_KEY=""`、`OPENAI_PRIMARY_MODEL="test-model"` → 强制走启发式路径
- **HTTP 拦截**: nock（host: `openviking-mock.test`），mock 定义在 `helpers/nock-openviking.ts`
- **Mock 端点**: `listSessions`、`createSession`、`search/find`、`search/search`、`sessions/*/messages`、`sessions/*/commit`、`sessions/*/used`
- **Server**: `helpers/server-factory.ts` 中 `startTestServer()` 启动随机端口
- **Client**: `helpers/chat-client.ts` 封装 HTTP 请求
- **Session Store**: 测试中自动降级为 `InMemorySessionStore`（无 REDIS_URL）

### Key Test Patterns

- `AGENT_CONFIDENCE_THRESHOLD=0` 防止启发式 reviewer 误触 handoff
- `HTTP_PROXY=""`、`NO_PROXY="*"` — 禁用系统代理（nock v14 + @mswjs/interceptors 不兼容代理）
- `mockOpenVikingAll()` — 全量 mock（空结果）
- `mockOpenVikingSessionWithExisting(sessionId)` — mock 已有 session

### Test Files

| File | Coverage |
|------|----------|
| `health.test.ts` | `/health`、404、错误处理 |
| `chat-routing.test.ts` | 意图分类 → 路由（闲聊、商品、订单、图搜、转人工） |
| `chat-media.test.ts` | 媒体消息 → visual_agent |
| `confidence.test.ts` | 置信度阈值 + handoff |
| `session-lifecycle.test.ts` | 会话创建、续接、查询 |
