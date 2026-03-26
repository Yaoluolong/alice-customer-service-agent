import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getConfiguredModel } from "../config/models";
import { buildComposerSystemPrompt } from "../config/persona";
import { AgentState, UserTone } from "../types";
import { resolveReplyLanguage } from "../utils/language";
import { getLastUserText } from "../utils/messages";
import { detectUserTone } from "../utils/style";

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
    { id: "en_c_1", text: "I can see why this feels confusing, let me break it down clearly." },
    { id: "en_c_2", text: "Good question. I'll walk you through the key points step by step." },
    { id: "en_c_3", text: "No worries, I'll make this simple and clear." },
    { id: "en_c_4", text: "You're asking the right thing, here's the clear version." },
    { id: "en_c_5", text: "Let me simplify this for you." }
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
    { id: "en_n_1", text: "I understand your request. Here's what I can confirm now." },
    { id: "en_n_2", text: "Got it. Let me share the key result and next step." },
    { id: "en_n_3", text: "Thanks, I've checked the relevant details for you." },
    { id: "en_n_4", text: "Understood. Here's the current status and what you can do next." },
    { id: "en_n_5", text: "I can help with that. Here's the confirmed information." }
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
  let trace = "compose:fallback";

  if (llm) {
    try {
      const response = await llm.invoke([
        new SystemMessage(
          await buildComposerSystemPrompt({
            language,
            styleProfile: state.style_profile,
            userTone,
            openingHint: opening.text,
            closingHint: closing,
            soulPrompt: state.tenant_config?.soulPrompt
          })
        ),
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
        reply = ensureOpeningAndClosing(candidate, opening.text, closing);
        trace = "compose:model";
      }
    } catch {
      trace = "compose:fallback";
    }
  }

  return {
    reply_language: language,
    tone_applied: userTone,
    variation_id: opening.id,
    draft_reply: reply,
    recent_opening_templates: [...state.recent_opening_templates, opening.id].slice(-3),
    messages: [new AIMessage(reply)],
    trace: [trace]
  };
};
