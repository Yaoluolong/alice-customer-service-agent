# Alice 多模态客服 Agent（TypeScript + LangGraph）

这是一个可运行的真人感客服 Agent 原型，支持文本+图片输入、结构化事实生成、自然语言回复、审校打分和信心阈值转人工。

## 核心架构

执行链路固定为：

`memory_bootstrap -> router -> domain_worker -> response_composer -> response_reviewer -> confidence_gate -> (human_handoff | memory_persist)`

### 节点职责

1. `memory_bootstrap`：加载用户偏好、风格、会话摘要（内部上下文，不直出给用户）
2. `router`：意图识别与路由（辅助模型）
3. `domain_worker`：
- `visual_agent`：图文检索
- `sales_agent`：库存与导购事实
- `order_agent`：订单事实
- `chat_agent`：闲聊/澄清事实
4. `response_composer`：按“四段式真人客服”生成最终回复（主模型）
5. `response_reviewer`：事实一致性、可执行性、自然度、重复度评分（辅助模型）
6. `confidence_gate`：低于阈值转人工
7. `human_handoff`：自然化转人工说明
8. `memory_persist`：写回偏好、风格和会话摘要

## 运行

```bash
npm install
cp .env.example .env
npm run build
npm run dev
```

## 环境变量

- `OPENAI_API_KEY`：OpenAI/兼容网关 Key（可选；不填时模型节点会走规则降级）
- `OPENAI_BASE_URL`：兼容网关地址（如 Ollama：`http://127.0.0.1:11434/v1`）
- `OPENAI_PRIMARY_MODEL`：主模型（必填）
- `OPENAI_AUX_MODEL`：辅助模型（可选；缺失时回退主模型）
- `AGENT_CONFIDENCE_THRESHOLD`：置信度阈值，默认 `0.7`，范围 `[0,1]`
- `DEFAULT_REPLY_LANGUAGE`：默认回复语言，默认 `zh-CN`
- `LANGUAGE_POLICY`：`auto` 或 `fixed`，默认 `auto`
- `SUPPORTED_LANGUAGES`：支持语言列表，默认 `zh-CN,en-US`
- `MAX_CONVERSATION_MESSAGES`：会话窗口大小，默认 `12`
- `LLM_TIMEOUT_MS`：模型调用超时毫秒，默认 `45000`
- `PORT`：HTTP 端口，默认 `3000`

## API

### 健康检查

```bash
curl http://localhost:3000/health
```

### 对话

```bash
curl -X POST http://localhost:3000/v1/chat \
  -H 'content-type: application/json' \
  -d '{
    "userId": "user_10001",
    "text": "[上传了一张红色风衣图片] 这个有红色的吗？我平时穿M码。",
    "image": {
      "imageId": "img_red_trench_001",
      "mimeType": "image/png",
      "filePath": "/tmp/red-trench.png"
    }
  }'
```

返回新增字段：

- `confidence`
- `reviewFlags`
- `handoffReason`
- `replyLanguage`

## 测试

```bash
npm test
```

当前包含：

1. env 解析与阈值边界测试
2. 语言策略（auto/fixed）测试
3. reviewer JSON 解析测试
4. confidence gate 规则测试（0.69/0.7/1.0）

## 目录

- `src/config/env.ts`：统一配置解析（模型、阈值、语言）
- `src/config/models.ts`：主/辅模型实例工厂
- `src/config/persona.ts`：router/composer/reviewer prompt 构建
- `src/nodes/*`：图节点实现
- `src/tests/*`：基础单元测试
