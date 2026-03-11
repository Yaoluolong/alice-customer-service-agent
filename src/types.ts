import { BaseMessage } from "@langchain/core/messages";

export enum UserIntent {
  PRODUCT_INQUIRY = "product_inquiry",
  ORDER_STATUS = "order_status",
  GENERAL_CHAT = "general_chat",
  VISUAL_SEARCH = "visual_search",
  UNKNOWN = "unknown"
}

export enum RouteTarget {
  VISUAL_AGENT = "visual_agent",
  SALES_AGENT = "sales_agent",
  ORDER_AGENT = "order_agent",
  CHAT_AGENT = "chat_agent",
  HUMAN_HANDOFF = "human_handoff"
}

export interface ProductInfo {
  id: string;
  name: string;
  category: string;
  colors: string[];
  sizes: string[];
  price: number;
  description: string;
  imageUrl?: string;
  similarityScore?: number;
}

export interface UserPreference {
  key: string;
  value: string | string[];
  category: "color" | "size" | "style" | "brand" | "other";
  confidence: number;
  timestamp: number;
}

export interface ImageContext {
  imageId: string;
  base64Data?: string;
  filePath?: string;
  mimeType: string;
  description?: string;
}

export type GroundingFactSource = "inventory" | "order" | "memory" | "retrieval" | "policy" | "chat";

export interface GroundingFact {
  key: string;
  value: string;
  source: GroundingFactSource;
  confidence: number;
}

export interface GroundingFacts {
  intent: UserIntent;
  facts: GroundingFact[];
  unknowns: string[];
  next_actions: string[];
  fact_confidence: number;
}

export type StyleVerbosity = "short" | "normal" | "detailed";
export type StyleFormality = "casual" | "neutral" | "formal";

export interface StyleProfile {
  addressStyle: string;
  verbosity: StyleVerbosity;
  formality: StyleFormality;
  warmth: number;
}

export type UserTone = "urgent" | "confused" | "polite" | "brief" | "neutral";

export interface AgentState {
  messages: BaseMessage[];
  user_id: string;
  session_id: string;
  user_intent: UserIntent;
  route_target: RouteTarget;
  current_product_id: string | null;
  image_context: ImageContext | null;
  retrieved_products: ProductInfo[];
  user_preferences: UserPreference[];
  requires_human: boolean;
  human_feedback?: string;

  grounding_facts: GroundingFacts | null;
  draft_reply: string | null;
  tone_applied: UserTone | null;
  variation_id: string | null;
  agent_confidence: number;
  review_flags: string[];
  confidence_reasons: string[];
  handoff_reason: string | null;
  reply_language: string;
  conversation_summary: string | null;
  style_profile: StyleProfile;
  recent_opening_templates: string[];

  trace: string[];
}

export interface ChatInput {
  userId: string;
  sessionId?: string;
  text: string;
  image?: ImageContext;
}

export interface ChatResult {
  sessionId: string;
  reply: string;
  intent: UserIntent;
  route: RouteTarget;
  productId: string | null;
  trace: string[];
  preferences: UserPreference[];
  confidence: number;
  handoffReason?: string;
  reviewFlags: string[];
  replyLanguage: string;
}

export function createInitialState(params: {
  sessionId: string;
  userId: string;
  userMessage: BaseMessage;
  imageContext?: ImageContext;
  replyLanguage?: string;
}): AgentState {
  return {
    messages: [params.userMessage],
    user_id: params.userId,
    session_id: params.sessionId,
    user_intent: UserIntent.UNKNOWN,
    route_target: RouteTarget.SALES_AGENT,
    current_product_id: null,
    image_context: params.imageContext ?? null,
    retrieved_products: [],
    user_preferences: [],
    requires_human: false,

    grounding_facts: null,
    draft_reply: null,
    tone_applied: null,
    variation_id: null,
    agent_confidence: 1,
    review_flags: [],
    confidence_reasons: [],
    handoff_reason: null,
    reply_language: params.replyLanguage ?? "zh-CN",
    conversation_summary: null,
    style_profile: {
      addressStyle: "你",
      verbosity: "normal",
      formality: "neutral",
      warmth: 0.7
    },
    recent_opening_templates: [],

    trace: []
  };
}
