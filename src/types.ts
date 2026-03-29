import { BaseMessage } from "@langchain/core/messages";

// --- Tenant Agent Configuration (config-driven multi-tenancy) ---

export type KnowledgeType = "faq" | "policies" | "guides" | "promotions";

export interface KnowledgeSchema {
  /** Product category tree — for path validation and search scope */
  productCategories: string[];
  /** Knowledge sub-directory types */
  knowledgeTypes: KnowledgeType[];
  /** Intent → target_uri mapping for scoped search */
  searchScopes: Record<string, string>;
}

export interface PreferenceExtractor {
  key: string;
  category: string;
  keywords: string[];
  pattern?: string;
  confidence: number;
}

export interface TenantAgentConfig {
  /** Custom soul prompt — overrides SOUL.md when provided */
  soulPrompt?: string;
  /** Enabled domain agents */
  enabledAgents?: RouteTarget[];
  /** Intent keyword overrides for heuristic router */
  routerKeywords?: Record<string, string[]>;
  /** Knowledge directory structure + search scopes */
  knowledgeSchema?: KnowledgeSchema;
  /** Custom preference extractors — replaces hardcoded extractPreferencesFromText */
  preferenceExtractors?: PreferenceExtractor[];
  /** Default reply language (default "zh-CN") */
  defaultLanguage?: string;
  /** Language detection policy */
  languagePolicy?: "auto" | "fixed";
  /** Confidence threshold override */
  confidenceThreshold?: number;
  /** Reserved for future tenant-specific external APIs */
  externalApis?: Record<string, { url: string; headers?: Record<string, string> }>;
}

// --- Core Enums & Types ---

export enum UserIntent {
  PRODUCT_INQUIRY = "product_inquiry",
  ORDER_STATUS = "order_status",
  GENERAL_CHAT = "general_chat",
  VISUAL_SEARCH = "visual_search",
  VIDEO_SEARCH = "video_search",
  KNOWLEDGE_QUERY = "knowledge_query",
  UNKNOWN = "unknown"
}

export enum RouteTarget {
  VISUAL_AGENT = "visual_agent",
  SALES_AGENT = "sales_agent",
  ORDER_AGENT = "order_agent",
  CHAT_AGENT = "chat_agent",
  KNOWLEDGE_AGENT = "knowledge_agent",
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
  category: string;
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

export type MediaType = "image" | "video";

export interface MediaContext {
  mediaId: string;
  mediaType: MediaType;
  base64Data?: string;
  url?: string;
  mimeType: string;
  description?: string;
  durationSeconds?: number;
}

export interface SearchItem {
  uri: string;
  abstract: string;
  score: number;
  context_type?: string;
}

export interface MemoryContext {
  shortTerm: {
    recentMessages: Array<{ role: string; content: string }>;
    sessionSummaries: string[];
  };
  longTerm: {
    profile: string | null;
    preferences: SearchItem[];
    entities: SearchItem[];
    events: SearchItem[];
  };
}

export type GroundingFactSource = "inventory" | "order" | "memory" | "retrieval" | "policy" | "chat";

export interface GroundingFact {
  key: string;
  value: string;
  source: GroundingFactSource;
  confidence: number;
  sourceUri?: string;
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
  tenant_id: string;
  customer_id: string;
  tenant_config: TenantAgentConfig | null;
  user_intent: UserIntent;
  route_target: RouteTarget;
  current_product_id: string | null;
  image_context: ImageContext | null;
  media_context: MediaContext | null;
  memory_context: MemoryContext | null;
  openviking_session_id: string | null;
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
  correlationId?: string;
  tenantId: string;
  customerId: string;
  userId: string;
  sessionId?: string;
  text: string;
  image?: ImageContext;
  media?: MediaContext;
  tenantConfig?: TenantAgentConfig;
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
  openVikingSessionId: string;
  memoriesLoaded: number;
}

export function createInitialState(params: {
  sessionId: string;
  userId: string;
  tenantId: string;
  customerId: string;
  userMessage: BaseMessage;
  imageContext?: ImageContext;
  mediaContext?: MediaContext;
  replyLanguage?: string;
  tenantConfig?: TenantAgentConfig;
}): AgentState {
  return {
    messages: [params.userMessage],
    user_id: params.userId,
    session_id: params.sessionId,
    tenant_id: params.tenantId,
    customer_id: params.customerId,
    tenant_config: params.tenantConfig ?? null,
    user_intent: UserIntent.UNKNOWN,
    route_target: RouteTarget.SALES_AGENT,
    current_product_id: null,
    image_context: params.imageContext ?? null,
    media_context: params.mediaContext ?? null,
    memory_context: null,
    openviking_session_id: null,
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
