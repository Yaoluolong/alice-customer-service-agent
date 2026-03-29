/**
 * Alice Eval Dataset — Type Definitions
 * 奢侈品代购场景 50 组对话评测数据集
 */

export type Intent =
  | "product_inquiry"
  | "visual_search"
  | "knowledge_query"
  | "order_status"
  | "general_chat"
  | "unknown";

export type RouteTarget =
  | "sales_agent"
  | "visual_agent"
  | "knowledge_agent"
  | "order_agent"
  | "chat_agent"
  | "human_handoff";

export type Difficulty = "easy" | "medium" | "hard";

export interface EvalMedia {
  type: "image" | "video" | "audio";
  url: string;
  mimetype?: string;
  caption?: string;
}

export interface EvalTurn {
  role: "user" | "assistant";
  content: string;
  media?: EvalMedia | null;
  context?: {
    memory?: Record<string, unknown> | null;
    session_history?: Array<{ role: string; content: string }>;
  };
}

export interface ScoringDimension {
  weight: number;
  criteria: string;
}

export interface ScoringRubric {
  /** 是否路由到正确的 agent */
  intent_accuracy: ScoringDimension;
  /** 回复内容是否基于 grounding facts，无编造 */
  answer_accuracy: ScoringDimension;
  /** 语气自然、情绪适配、无机械模板感 */
  human_likeness: ScoringDimension;
  /** 是否给出可执行方案和明确下一步 */
  problem_solving: ScoringDimension;
  /** 是否正确引用产品/政策/知识库信息 */
  knowledge_citation: ScoringDimension;
  /** 回复长度适当、有主动引导、转人工合理 */
  user_experience: ScoringDimension;
}

export interface EvalExpected {
  intent: Intent;
  route: RouteTarget;
  /** 回复中必须包含的关键词或短语 */
  must_contain: string[];
  /** 回复中不应出现的词语（编造信息、机械用语等） */
  must_not_contain?: string[];
  /** 是否应引用 grounding facts（产品/知识库） */
  should_cite_knowledge: boolean;
  /** 是否预期转人工 */
  should_handoff: boolean;
}

export interface EvalCase {
  id: string;
  name: string;
  category:
    | "product_inquiry"
    | "visual_search"
    | "knowledge_query"
    | "order_status"
    | "general_chat"
    | "edge_case";
  tags: string[];
  difficulty: Difficulty;
  /** 对话轮次。单轮只有一个 user turn；多轮含交替的 user/assistant turns */
  turns: EvalTurn[];
  expected: EvalExpected;
  scoring_rubric: ScoringRubric;
}

export interface EvalDataset {
  version: string;
  metadata: {
    business: string;
    created: string;
    total_cases: number;
    description: string;
  };
  cases: EvalCase[];
}
