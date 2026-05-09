import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getConfiguredModel } from "../config/models";
import { buildComposerSystemPrompt } from "../config/persona";
import { AgentState, TraceEntry, UserTone } from "../types";
import { resolveReplyLanguage } from "../utils/language";
import { getLastUserText } from "../utils/messages";
import { detectUserTone } from "../utils/style";

// --- CoT parsing helpers ---

export interface CoTResult {
  thinking: string | null;
  reply: string;
  formatMiss: boolean;
}

export function parseCoTResponse(raw: string): CoTResult {
  const thinkingMatch = raw.match(/<thinking>([\s\S]*?)<\/thinking>/);
  const replyMatch = raw.match(/<reply>([\s\S]*?)<\/reply>/);
  if (!replyMatch) return { thinking: null, reply: raw.trim(), formatMiss: true };
  let thinking = thinkingMatch ? thinkingMatch[1].trim() : null;
  if (thinking && thinking.length > 500) thinking = thinking.slice(0, 500);
  return { thinking, reply: replyMatch[1].trim(), formatMiss: false };
}

export function getOverallRelevance(factConfidence: number): "high" | "medium" | "low" {
  if (factConfidence > 0.7) return "high";
  if (factConfidence >= 0.4) return "medium";
  return "low";
}

interface VariationTemplate {
  id: string;
  text: string;
}

const ZH_OPENING_POOL: Record<UserTone, VariationTemplate[]> = {
  urgent: [
    { id: "zh_u_1", text: "明白你现在比较着急，我直接给你关键信息。" },
    { id: "zh_u_2", text: "我理解你想尽快确认结果，我先说重点。" },
    { id: "zh_u_3", text: "收到，我先按最快方式给你结论。" },
    { id: "zh_u_4", text: "你这个需求我优先处理，先给你最关键的信息。" },
    { id: "zh_u_5", text: "我知道你在赶时间，我先把结论告诉你。" }
  ],
  confused: [
    { id: "zh_c_1", text: "我明白你现在有点困惑，我帮你一步步梳理。" },
    { id: "zh_c_2", text: "这个问题我来给你讲清楚，先从关键点开始。" },
    { id: "zh_c_3", text: "别担心，我先把核心信息讲明白。" },
    { id: "zh_c_4", text: "你问得很关键，我按最清楚的方式说明。" },
    { id: "zh_c_5", text: "我来帮你理顺一下，先看最重要的部分。" }
  ],
  polite: [
    { id: "zh_p_1", text: "收到你的需求，我这边马上帮你确认。" },
    { id: "zh_p_2", text: "感谢你说明得很清楚，我先反馈核心结果。" },
    { id: "zh_p_3", text: "好的，我已经按你的需求开始核对。" },
    { id: "zh_p_4", text: "明白了，我先把你最关心的结果告诉你。" },
    { id: "zh_p_5", text: "谢谢你的耐心描述，我先给你结论。" }
  ],
  brief: [
    { id: "zh_b_1", text: "收到，给你简版结论：" },
    { id: "zh_b_2", text: "明白，我用最短方式回答你。" },
    { id: "zh_b_3", text: "好的，我直接说重点。" },
    { id: "zh_b_4", text: "了解，下面是关键信息。" },
    { id: "zh_b_5", text: "可以，我只保留你要点。" }
  ],
  neutral: [
    { id: "zh_n_1", text: "我理解你的需求，先把当前结果同步给你。" },
    { id: "zh_n_2", text: "收到，我先给你核心信息和下一步建议。" },
    { id: "zh_n_3", text: "明白，我先反馈确认到的内容。" },
    { id: "zh_n_4", text: "好的，我先说结论，再给你可执行建议。" },
    { id: "zh_n_5", text: "我已经帮你核对，先看当前结果。" }
  ]
};

const EN_OPENING_POOL: Record<UserTone, VariationTemplate[]> = {
  urgent: [
    { id: "en_u_1", text: "I understand this is urgent, so I'll start with the key result." },
    { id: "en_u_2", text: "You're in a hurry, so here's the important part first." },
    { id: "en_u_3", text: "Got it, I'll keep this fast and focused." },
    { id: "en_u_4", text: "I know timing matters here, so I'll give you the core update first." },
    { id: "en_u_5", text: "I hear you, let's go straight to the point." }
  ],
  confused: [
    { id: "en_c_1", text: "Totally get it — let me clear this up for you, love." },
    { id: "en_c_2", text: "Right, so here's the thing —" },
    { id: "en_c_3", text: "Okay, so —" },
    { id: "en_c_4", text: "Ha, it's a fair thing to wonder! So:" },
    { id: "en_c_5", text: "Great minds wonder! Here's the honest answer:" }
  ],
  polite: [
    { id: "en_p_1", text: "Thanks for the details. I've checked the key information for you." },
    { id: "en_p_2", text: "Got it, and thank you for explaining clearly." },
    { id: "en_p_3", text: "Understood. I'll share the result first, then next steps." },
    { id: "en_p_4", text: "Thanks for your patience, here's what I confirmed." },
    { id: "en_p_5", text: "I appreciate the context. Here's the core update." }
  ],
  brief: [
    { id: "en_b_1", text: "Got it. Short answer:" },
    { id: "en_b_2", text: "Sure, here's the quick version." },
    { id: "en_b_3", text: "Understood. Main points only:" },
    { id: "en_b_4", text: "Absolutely. Here's the concise update." },
    { id: "en_b_5", text: "Makes sense. Quick summary:" }
  ],
  neutral: [
    { id: "en_n_1", text: "Right, so —" },
    { id: "en_n_2", text: "Okay love, so here's the deal:" },
    { id: "en_n_3", text: "Brilliant question, and the answer's simpler than you'd think:" },
    { id: "en_n_4", text: "Here's what I know:" },
    { id: "en_n_5", text: "So —" }
  ]
};

const ZH_CLOSINGS = [
  "如果你愿意，我可以继续帮你把下一步也一起处理掉。",
  "你再补充一点信息，我可以马上把结果收敛到更准确。",
  "如果你现在方便，我可以直接按这个方向继续帮你推进。",
  "你告诉我你的优先项，我就按你的节奏继续。",
  "我会一直跟进到你拿到明确结果为止。"
];

const EN_CLOSINGS = [
  "If you want, I can handle the next step for you right away.",
  "Share one more detail and I can narrow this down quickly.",
  "If that works for you, I'll continue from here immediately.",
  "Tell me your priority and I'll follow your pace.",
  "I'll stay on this with you until we get a clear outcome."
];

const chooseTemplate = (pool: VariationTemplate[], recentIds: string[]): VariationTemplate => {
  const recent = recentIds.slice(-3);
  const available = pool.filter((item) => !recent.includes(item.id));
  const source = available.length > 0 ? available : pool;
  return source[Math.floor(Math.random() * source.length)];
};

const chooseClosing = (language: string): string => {
  const pool = language === "en-US" ? EN_CLOSINGS : ZH_CLOSINGS;
  return pool[Math.floor(Math.random() * pool.length)];
};

const summarizeFacts = (state: AgentState, language: string): string => {
  const grounding = state.grounding_facts;
  if (!grounding || grounding.facts.length === 0) {
    return language === "en-US"
      ? "I don't have enough confirmed details yet."
      : "目前我掌握的确定信息还不够完整。";
  }
  return grounding.facts.map((fact) => `${fact.key}: ${fact.value}`).join("\n");
};

const summarizeActions = (state: AgentState, language: string): string => {
  const actions = state.grounding_facts?.next_actions ?? [];
  if (actions.length > 0) return actions.join(language === "en-US" ? " | " : "；");
  return language === "en-US"
    ? "I can continue checking details for you if needed."
    : "如果你愿意，我可以继续帮你补充核对。";
};

const buildFallbackReply = (params: {
  opening: string;
  facts: string;
  actions: string;
  closing: string;
  language: string;
}): string => {
  if (params.language === "en-US") {
    return `${params.opening}\n\nHere is what I can confirm:\n${params.facts}\n\nNext step:\n${params.actions}\n\n${params.closing}`;
  }
  return `${params.opening}\n\n我这边确认到的信息：\n${params.facts}\n\n建议你下一步这样做：\n${params.actions}\n\n${params.closing}`;
};

const ensureOpeningAndClosing = (reply: string, opening: string, closing: string): string => {
  let output = reply.trim();
  if (!output.startsWith(opening.slice(0, 6))) {
    output = `${opening}\n\n${output}`;
  }
  if (!output.includes(closing.slice(0, 8))) {
    output = `${output}\n\n${closing}`;
  }
  return output;
};

export const responseComposerNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  const language = resolveReplyLanguage(state.messages);

  // --- Path 1: Clarification bypass ---
  if (state.requires_clarification && state.draft_reply) {
    const clarificationTrace: TraceEntry = {
      node: "composer",
      displayName: "Response Composer",
      input: "Clarification bypass",
      output: `Passed through clarification message (${state.draft_reply.length} chars)`,
      metadata: { method: "clarification_bypass", severity: "ok" },
    };
    return {
      draft_reply: state.draft_reply,
      reply_language: language,
      tone_applied: "neutral",
      messages: [new AIMessage(state.draft_reply)],
      trace: [clarificationTrace],
    };
  }

  // --- Path 2: Conversation closing bypass ---
  if (state.conversation_closing) {
    const ZH_CLOSING_REPLIES = [
      "好的，有需要随时找我！祝你一切顺利~",
      "不客气！有任何问题随时来找我哦~",
      "好的，祝你今天心情愉快！下次见~",
      "收到，随时欢迎回来！",
      "好的好的，有需要再找我~",
    ];
    const EN_CLOSING_REPLIES = [
      "You're welcome! Feel free to reach out anytime.",
      "Happy to help! Don't hesitate to come back if you need anything.",
      "Take care! I'm here whenever you need me.",
      "No problem at all! See you next time.",
      "Glad I could help! Have a great day.",
    ];
    const pool = language.startsWith("en") ? EN_CLOSING_REPLIES : ZH_CLOSING_REPLIES;
    const reply = pool[Math.floor(Math.random() * pool.length)];
    const closingTrace: TraceEntry = {
      node: "composer",
      displayName: "Response Composer",
      input: "Conversation closing",
      output: `Generated closing reply (${reply.length} chars)`,
      metadata: { method: "closing_bypass", severity: "ok" },
    };
    return {
      draft_reply: reply,
      reply_language: language,
      tone_applied: "neutral",
      messages: [new AIMessage(reply)],
      trace: [closingTrace],
    };
  }

  // --- Path 3: Normal flow ---
  const userText = getLastUserText(state.messages);
  const userTone = detectUserTone(userText);
  const openingPool = language === "en-US" ? EN_OPENING_POOL[userTone] : ZH_OPENING_POOL[userTone];
  const opening = chooseTemplate(openingPool, state.recent_opening_templates);
  const closing = chooseClosing(language);

  const factsSummary = summarizeFacts(state, language);
  const actionSummary = summarizeActions(state, language);

  const llm = getConfiguredModel("primary", 0.7);

  const fallback = buildFallbackReply({
    opening: opening.text,
    facts: factsSummary,
    actions: actionSummary,
    closing,
    language
  });

  let reply = fallback;
  let method = "fallback";

  let cotThinking: string | null = null;
  let cotFormatMiss = false;

  if (llm) {
    try {
      // Compute overall relevance for CoT low-confidence note
      const avgConfidence = state.grounding_facts?.facts.length
        ? state.grounding_facts.facts.reduce((sum, f) => sum + f.confidence, 0) / state.grounding_facts.facts.length
        : 0;
      const relevance = getOverallRelevance(avgConfidence);

      const cotInstruction = language === "en-US"
        ? [
            "",
            "Before replying, you MUST reason inside a <thinking> block:",
            "1. Available facts: list all grounding facts and note each one's reliability",
            "2. User's real intent: based on the current message + conversation history, what does the user actually want?",
            "3. Reply strategy: decide which facts to cite, in what order, and with what tone",
            "Keep <thinking> under 200 words.",
            "Then output your final reply inside a <reply> block.",
          ].join("\n")
        : [
            "",
            "在回复用户之前，你必须先在 <thinking> 块中完成以下推理：",
            "1. 可用事实清单：列出所有 grounding facts，标注每条的可靠度",
            "2. 用户真实意图：基于当前消息 + 对话历史，判断用户到底想要什么",
            "3. 回复策略：决定引用哪些 facts、以什么顺序、什么语气",
            "<thinking> 块控制在 200 字以内。",
            "然后在 <reply> 块中输出最终回复。",
          ].join("\n");

      const lowConfidenceNote = relevance === "low"
        ? language === "en-US"
          ? "\n\nIMPORTANT: Search result confidence is low. Honestly tell the user you're not certain, proactively ask for more details. Do NOT fabricate information."
          : "\n\n重要：检索结果置信度低，请诚实告知用户你不确定，并主动询问更多细节。不要编造信息。"
        : "";

      const baseSystemPrompt = await buildComposerSystemPrompt({
        language,
        styleProfile: state.style_profile,
        userTone,
        openingHint: opening.text,
        closingHint: closing,
        soulPrompt: state.tenant_config?.soulPrompt
      });

      const systemPrompt = baseSystemPrompt + cotInstruction + lowConfidenceNote;

      const response = await llm.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(
          JSON.stringify({
            language,
            user_tone: userTone,
            style_profile: state.style_profile,
            grounding_facts: state.grounding_facts,
            conversation_summary: state.conversation_summary,
            user_message: userText,
            facts_summary: factsSummary,
            action_summary: actionSummary,
            customer_profile: state.memory_context?.longTerm?.profile ?? null,
            customer_preferences: state.memory_context?.longTerm?.preferences?.slice(0, 5).map((p) => p.abstract).join("; ") ?? null,
            past_interactions: state.memory_context?.shortTerm?.sessionSummaries?.slice(0, 2) ?? null
          })
        )
      ]);

      const candidate = String(response.content ?? "").trim();
      if (candidate.length > 0) {
        const cot = parseCoTResponse(candidate);
        cotThinking = cot.thinking;
        cotFormatMiss = cot.formatMiss;
        const parsedReply = cot.reply;
        reply = ensureOpeningAndClosing(parsedReply, opening.text, closing);
        method = "llm";
      }
    } catch {
      method = "fallback";
    }
  }

  const composerTrace: TraceEntry = {
    node: "composer",
    displayName: "Response Composer",
    input: `Tone: ${userTone}, Language: ${language}`,
    output: method === "llm"
      ? `LLM composed reply (${reply.length} chars)`
      : `Fallback composed reply (${reply.length} chars)`,
    metadata: { tone: userTone, language, method, replyLength: reply.length, severity: "ok" },
  };

  if (cotThinking && composerTrace.metadata) {
    composerTrace.metadata.cot_thinking = cotThinking;
  }
  if (cotFormatMiss && composerTrace.metadata) {
    composerTrace.metadata.cot_format_miss = true;
  }

  return {
    reply_language: language,
    tone_applied: userTone,
    variation_id: opening.id,
    draft_reply: reply,
    recent_opening_templates: [...state.recent_opening_templates, opening.id].slice(-3),
    messages: [new AIMessage(reply)],
    trace: [composerTrace]
  };
};
