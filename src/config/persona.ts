import { readFile } from "node:fs/promises";
import path from "node:path";
import { StyleProfile, UserTone } from "../types";

const SOUL_PROMPT_PATH = path.resolve(process.cwd(), "agents", "SOUL.md");

export const BANNED_MECHANICAL_PHRASES = [
  "已读取历史偏好",
  "系统检测到",
  "当前请求需要人工处理",
  "system detected",
  "request requires manual processing",
  // EN opening pool phrases that contradict SOUL.md "no filler" directive
  "good question. i'll walk you through",
  "no worries, i'll make this simple and clear",
  "i can see why this feels confusing, let me break it down clearly",
  "i'll walk you through the key points step by step",
  "let me simplify this for you"
];

const readSoulPromptMarkdown = async (): Promise<string | null> => {
  try {
    const raw = await readFile(SOUL_PROMPT_PATH, "utf8");
    const content = raw.trim();
    return content.length > 0 ? content : null;
  } catch {
    return null;
  }
};

const buildPrompt = async (taskInstruction: string, soulPromptOverride?: string): Promise<string> => {
  const soulMarkdown = soulPromptOverride ?? await readSoulPromptMarkdown();
  if (!soulMarkdown) {
    throw new Error("缺少客服人设配置：请在项目根目录创建并填写 agents/SOUL.md");
  }
  return [soulMarkdown, "", "任务规则：", taskInstruction].join("\n");
};

export const buildRouterSystemPrompt = async (soulPrompt?: string): Promise<string> =>
  buildPrompt(
    "你是客服路由器。只输出一个意图: visual_search/knowledge_query/product_inquiry/order_status/general_chat/unknown。若 has_media=true 必须输出 visual_search。knowledge_query 用于：退换货政策、售后、保修、运费、支付方式、关税、下单流程、商品保养与护理方法、正品验货说明、团队介绍、折扣码政策、货到付款、批发询价等规则/流程类问题；product_inquiry 用于商品咨询、库存、价格、推荐、尺码对比。禁止输出其他内容。",
    soulPrompt
  );

export const buildComposerSystemPrompt = async (params: {
  language: string;
  styleProfile: StyleProfile;
  userTone: UserTone;
  openingHint: string;
  closingHint: string;
  soulPrompt?: string;
}): Promise<string> => {
  const languageHint = params.language === "en-US" ? "Respond in natural English." : "使用自然中文回复。";
  const instruction = [
    "你是面向真实用户的一线客服，不要像系统公告。",
    "回复必须按四段式自然融合：理解用户 -> 给出事实 -> 给出动作 -> 收束语气。",
    "只允许引用输入中的 grounding facts，不得编造库存、订单、物流、价格。",
    "信息不确定时，必须使用：说明不确定 + 要求补充 + 给替代路径。",
    "若输入包含 customer_profile 或 customer_preferences，自然地融入回复中，体现个性化服务，但不要使用【根据您的历史记录】等机械表达。",
    "若有过往互动摘要（past_interactions），可作为背景参考，但不要直接引用。",
    `语气偏好：${params.userTone}；风格：${JSON.stringify(params.styleProfile)}。`,
    `开场建议：${params.openingHint}`,
    `收束建议：${params.closingHint}`,
    `严格禁止以下词句，违反将导致回复被拒绝：${BANNED_MECHANICAL_PHRASES.join(" / ")}。开场不得以"好问题""好的，我先""明白，我先""收到，我先"等机械引导语开头。`,
    languageHint,
    "直接输出给用户的最终回复，不要输出解释。"
  ].join("\n");

  return buildPrompt(instruction, params.soulPrompt);
};

export const buildReviewerSystemPrompt = async (language: string, soulPrompt?: string): Promise<string> => {
  const instruction = [
    "你是客服回复审校器。请基于输入内容严格评分并输出 JSON。",
    "评分维度：事实一致性(0.5)、可执行性(0.2)、自然度(0.2)、重复模板惩罚(0.1)。",
    "输出必须是 JSON 对象，字段固定：score(0-1), flags(string[]), reasons(string[]), must_handoff(boolean)。",
    `若发现机械词（${BANNED_MECHANICAL_PHRASES.join("/")}）需加入 flags。`,
    "must_handoff 仅在以下情况设为 true：回复包含明确的错误数字（如错误的价格、错误的订单号）并被当作事实陈述。",
    "品牌或商品不匹配（如客户问A品牌但知识库只有B品牌）不得触发 must_handoff，应降低 score 但保持 must_handoff=false，因为客服无法控制知识库覆盖范围。",
    language === "en-US" ? "Reasons should be in English." : "Reasons 使用中文。"
  ].join("\n");

  return buildPrompt(instruction, soulPrompt);
};
