# Alice Eval Dataset — 奢侈品代购场景

Alice 客服引擎评测数据集，50 组真实销售对话，覆盖全部 domain agent，从 6 个维度量化评分。

## 文件结构

```
Alice/tests/eval/
├── dataset.json    # 50 组测试用例（主文件）
├── scoring.ts      # TypeScript 类型定义
└── README.md       # 本文档
```

## 数据集概览

| 维度 | 统计 |
|------|------|
| 总用例数 | 50 |
| 单轮对话 | 30 (S01-S30) |
| 多轮对话 | 20 (M01-M20) |
| 业务场景 | 奢侈品代购（中英混合） |

### 按意图/Agent 分布

| 类别 | 数量 | 覆盖 Agent |
|------|------|-----------|
| 商品咨询 | 13 | sales_agent |
| 图片搜索 | 6 | visual_agent → sales_agent |
| 知识问答 | 9 | knowledge_agent |
| 订单查询 | 6 | order_agent |
| 闲聊/打招呼 | 6 | chat_agent |
| 边界/混合意图 | 10 | 多 agent / human_handoff |

### 难度分布

- **easy**: 14 组（基础功能验证）
- **medium**: 22 组（正常业务场景）
- **hard**: 14 组（边界、多轮、复杂意图）

## Case 结构

每个 case 包含四个部分：

```jsonc
{
  "id": "S01",           // S=单轮, M=多轮
  "name": "...",
  "category": "...",
  "tags": ["..."],
  "difficulty": "easy|medium|hard",
  "turns": [             // 对话轮次（单轮=1个user turn）
    {
      "role": "user",
      "content": "...",
      "media": null,     // 或 { "type": "image", "url": "..." }
      "context": {
        "memory": null,  // 注入的历史记忆（测试记忆召回）
        "session_history": []
      }
    }
  ],
  "expected": {
    "intent": "product_inquiry",
    "route": "sales_agent",
    "must_contain": ["关键词"],
    "must_not_contain": ["禁止词"],
    "should_cite_knowledge": true,
    "should_handoff": false
  },
  "scoring_rubric": {    // 6个维度，每个 weight 1.0 = 满分
    "intent_accuracy": { "weight": 1.0, "criteria": "..." },
    "answer_accuracy": { "weight": 1.0, "criteria": "..." },
    "human_likeness": { "weight": 1.0, "criteria": "..." },
    "problem_solving": { "weight": 1.0, "criteria": "..." },
    "knowledge_citation": { "weight": 1.0, "criteria": "..." },
    "user_experience": { "weight": 1.0, "criteria": "..." }
  }
}
```

## 6 个评分维度

每维度 1-5 分，按 weight 加权后得总分：

| 维度 | 说明 | 1分 | 5分 |
|------|------|-----|-----|
| **意图分析准确性** | 路由到正确 agent | 完全错误 | 完全准确 |
| **答案准确性** | 基于 grounding facts，无编造 | 编造信息 | 完全基于事实 |
| **回复像真人** | 语气自然，情绪适配 | 机械模板感重 | 完全像真人客服 |
| **解决问题能力** | 给出可执行方案 | 无实质帮助 | 具体方案+下一步 |
| **知识引用能力** | 正确引用产品/政策 | 无引用或错误 | 精准引用，来源可追溯 |
| **用户体验** | 长度适当、有引导、转人工合理 | 过长/过短/无引导 | 长度适中，体验顺畅 |

## 如何使用

### 手动测试（spot check）

1. 取 `turns` 中最后一个 `user` 消息发给 Alice
2. 对照 `expected` 检查：intent、route、must_contain、should_handoff
3. 按 `scoring_rubric` 对 6 个维度打分（1-5分）
4. 总分 = Σ(score_i × weight_i) / Σ(weight_i)

### 多轮测试

多轮 case（M 系列）的最后一个 `user` turn 是被评测的消息；前面的 `assistant` turns 提供历史上下文。测试时需按序向 Alice 发送全部 turns，评测最后一次 Alice 的回复。

### 自动化接入

```typescript
import dataset from './dataset.json';
import type { EvalCase } from './scoring';

const cases = dataset.cases as EvalCase[];

for (const c of cases) {
  const lastUserTurn = c.turns.filter(t => t.role === 'user').at(-1)!;
  const response = await postChat(aliceUrl, {
    tenant_id: 'test_tenant',
    customer_id: 'test_customer',
    message: lastUserTurn.content,
    media: lastUserTurn.media ?? undefined,
  });

  // 检查 must_contain
  for (const keyword of c.expected.must_contain) {
    assert(response.reply.includes(keyword), `[${c.id}] must_contain: ${keyword}`);
  }
  // 检查 intent / route
  assert.equal(response.intent, c.expected.intent, `[${c.id}] intent`);
  assert.equal(response.route, c.expected.route, `[${c.id}] route`);
}
```

### 按维度筛选用例

```bash
# 找所有测试 knowledge_citation 高权重的 case
node -e "
const d = require('./dataset.json');
d.cases
  .filter(c => c.scoring_rubric.knowledge_citation.weight >= 1.0)
  .forEach(c => console.log(c.id, c.name));
"

# 找所有 hard 难度 case
node -e "
const d = require('./dataset.json');
d.cases.filter(c=>c.difficulty==='hard').forEach(c=>console.log(c.id, c.name));
"
```

## 典型代购业务场景覆盖

| 场景 | Case ID |
|------|---------|
| 品牌/型号价格咨询 | S01, S07 |
| 成色等级价差 | S05, S16 |
| 爱马仕配货 | S08 |
| 图片找同款 | S09-S12 |
| 关税/运费政策 | S14, S15 |
| 退换货流程 | S13, M08, M09 |
| 鉴定保真 | S17 |
| 代购全流程 | M10 |
| 催单/情绪安抚 | S21 |
| 砍价/低成色替代 | M05 |
| 跨会话记忆召回 | M20 |

## 注意事项

- **Mock 数据限制**: Alice 当前订单系统和库存是 mock 数据（1条订单 + 3款风衣）。评测订单/库存 case 时，`must_contain` 仅验证格式和流程，不验证具体数字。
- **媒体 URL**: `media.url` 使用占位域名 `example-media.test`，实际评测需替换为真实 CDN URL 或 mock。
- **记忆场景**: M20 的 `context.memory` 字段模拟了已存在的历史偏好，测试 Alice 是否自然融入记忆而非机械引用。
