import { HumanMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { inventoryService } from "../mocks/inventory";
import { resolveOvClient } from "../clients/resolve-ov-client";
import { AgentState, GroundingFacts, PreferenceExtractor, ProductInfo, UserPreference, UserIntent } from "../types";
import { updateStyleProfileFromUserText } from "../utils/style";

const dedupePreferences = (preferences: UserPreference[]): UserPreference[] => {
  const seen = new Set<string>();
  const output: UserPreference[] = [];
  for (const preference of preferences) {
    const key = `${preference.key}:${JSON.stringify(preference.value)}`;
    if (!seen.has(key)) {
      seen.add(key);
      output.push(preference);
    }
  }
  return output;
};

const getLastUserText = (state: AgentState): string => {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    if (state.messages[i] instanceof HumanMessage) {
      return String(state.messages[i].content ?? "");
    }
  }
  return "";
};

const pickPreference = (preferences: UserPreference[], key: string, fallback: string): string => {
  const hit = preferences.find((preference) => preference.key === key);
  if (!hit) return fallback;
  if (Array.isArray(hit.value)) return String(hit.value[0] ?? fallback);
  return String(hit.value);
};

/** Default extractors — legacy hardcoded behavior for clothing tenants */
const DEFAULT_EXTRACTORS: PreferenceExtractor[] = [
  {
    key: "preferred_colors",
    category: "color",
    keywords: ["红色", "黑色", "白色", "蓝色", "绿色", "黄色", "紫色", "粉色", "橙色", "灰色", "卡其色", "米色", "驼色"],
    confidence: 0.85
  },
  {
    key: "preferred_sizes",
    category: "size",
    keywords: [],
    pattern: "\\b(XXXL|XXL|XL|L|M|S|XS)\\b",
    confidence: 0.9
  },
  {
    key: "preferred_styles",
    category: "style",
    keywords: ["商务", "休闲", "经典", "简约", "时尚", "复古", "运动"],
    confidence: 0.7
  }
];

const extractPreferencesFromText = (text: string, extractors?: PreferenceExtractor[]): UserPreference[] => {
  const activeExtractors = extractors ?? DEFAULT_EXTRACTORS;
  const preferences: UserPreference[] = [];
  const timestamp = Date.now();

  for (const extractor of activeExtractors) {
    const matches: string[] = [];

    // Keyword matching
    if (extractor.keywords.length > 0) {
      for (const kw of extractor.keywords) {
        if (text.includes(kw)) matches.push(kw);
      }
    }

    // Regex pattern matching
    if (extractor.pattern) {
      const regex = new RegExp(extractor.pattern, "gi");
      const regexMatches = text.match(regex);
      if (regexMatches) {
        matches.push(...regexMatches.map((m) => m.toUpperCase()));
      }
    }

    if (matches.length > 0) {
      const uniqueMatches = [...new Set(matches)];
      preferences.push({
        key: extractor.key,
        value: uniqueMatches,
        category: extractor.category,
        confidence: extractor.confidence,
        timestamp
      });
    }
  }

  return preferences;
};

const searchItemsToProducts = (items: Array<{ uri: string; abstract: string; score: number }>): ProductInfo[] =>
  items.map((item, idx) => ({
    id: item.uri.split("/").filter(Boolean).pop() ?? `prod_${idx}`,
    name: item.abstract.split("\n")[0]?.slice(0, 80) ?? item.uri,
    category: item.uri.replace("viking://resources/products/", ""),
    colors: [],
    sizes: [],
    price: 0,
    description: item.abstract,
    imageUrl: item.uri,
    similarityScore: item.score
  }));

export const salesAgentNode = async (state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> => {
  const openVikingClient = resolveOvClient(config);
  const userText = getLastUserText(state);
  const tenantConfig = state.tenant_config;
  const newPrefs = extractPreferencesFromText(userText, tenantConfig?.preferenceExtractors);
  const mergedPrefs = dedupePreferences([...state.user_preferences, ...newPrefs]);
  const nextStyle = updateStyleProfileFromUserText(state.style_profile, userText);

  // If no products yet, search the tenant knowledge base
  let retrievedProducts = state.retrieved_products;
  if (retrievedProducts.length === 0 && state.tenant_id) {
    try {
      const result = await openVikingClient.search(
        state.tenant_id,
        state.customer_id,
        userText,
        state.openviking_session_id ?? undefined,
        tenantConfig?.knowledgeSchema?.searchScopes?.product_inquiry ?? "viking://resources/products/",
        5
      );
      const items = [...(result.resources ?? []), ...(result.memories ?? [])].sort(
        (a, b) => b.score - a.score
      );
      retrievedProducts = searchItemsToProducts(items);
    } catch {
      // Non-fatal
    }
  }

  const product = state.current_product_id
    ? retrievedProducts.find((item) => item.id === state.current_product_id) ?? null
    : retrievedProducts[0] ?? null;

  if (!product) {
    const noProductFacts: GroundingFacts = {
      intent: UserIntent.PRODUCT_INQUIRY,
      facts: [],
      unknowns: ["缺少商品上下文"],
      next_actions: ["请补充图片或商品关键词", "如有目标款式可直接告诉我颜色和尺码"],
      fact_confidence: 0.35
    };

    return {
      retrieved_products: retrievedProducts,
      user_preferences: mergedPrefs,
      style_profile: nextStyle,
      grounding_facts: noProductFacts,
      trace: ["sales:no-product"]
    };
  }

  const inventory = await inventoryService.queryInventory(product.id, product);
  const color = pickPreference(mergedPrefs, "preferred_colors", "红色");
  const size = pickPreference(mergedPrefs, "preferred_sizes", "M");

  const sku = inventory.inventory.find(
    (item) => item.color === color && item.size === size && item.available > 0
  );

  const facts: GroundingFacts = {
    intent: UserIntent.PRODUCT_INQUIRY,
    fact_confidence: sku ? 0.92 : 0.76,
    facts: [
      { key: "product_name", value: product.name, source: "retrieval", confidence: 0.9, sourceUri: product.imageUrl },
      { key: "price", value: `¥${product.price}`, source: "retrieval", confidence: 0.9 },
      { key: "preferred_color", value: color, source: "memory", confidence: 0.8 },
      { key: "preferred_size", value: size, source: "memory", confidence: 0.8 },
      {
        key: "availability",
        value: sku
          ? `${color}${size} 有货（SKU ${sku.sku}，可用 ${sku.available} 件）`
          : `${color}${size} 暂无现货`,
        source: "inventory",
        confidence: sku ? 0.95 : 0.9
      },
      {
        key: "options",
        value: `颜色：${[...new Set(inventory.inventory.map((i) => i.color))].join("/")}；尺码：${[
          ...new Set(inventory.inventory.map((i) => i.size))
        ].join("/")}`,
        source: "inventory",
        confidence: 0.95
      }
    ],
    unknowns: [],
    next_actions: sku
      ? ["如需下单，请告诉我收货城市和期望到货时间", "我可以继续帮你对比其他颜色"]
      : ["可以换一个尺码或颜色，我立刻帮你再查", "我也可以推荐同价位可替代款"]
  };

  return {
    current_product_id: product.id,
    retrieved_products: retrievedProducts,
    user_preferences: mergedPrefs,
    style_profile: nextStyle,
    grounding_facts: facts,
    trace: [`sales:product=${product.id}`]
  };
};
