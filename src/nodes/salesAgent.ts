import { HumanMessage } from "@langchain/core/messages";
import { inventoryService } from "../mocks/inventory";
import { extractPreferences } from "../mocks/openviking";
import { AgentState, GroundingFacts, UserPreference, UserIntent } from "../types";
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

export const salesAgentNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  const userText = getLastUserText(state);
  const newPrefs = extractPreferences(userText);
  const mergedPrefs = dedupePreferences([...state.user_preferences, ...newPrefs]);
  const nextStyle = updateStyleProfileFromUserText(state.style_profile, userText);

  const product = state.current_product_id
    ? state.retrieved_products.find((item) => item.id === state.current_product_id) ?? null
    : state.retrieved_products[0] ?? null;

  if (!product) {
    const noProductFacts: GroundingFacts = {
      intent: UserIntent.PRODUCT_INQUIRY,
      facts: [],
      unknowns: ["缺少商品上下文"],
      next_actions: ["请补充图片或商品关键词", "如有目标款式可直接告诉我颜色和尺码"],
      fact_confidence: 0.35
    };

    return {
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
      { key: "product_name", value: product.name, source: "retrieval", confidence: 0.9 },
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
    user_preferences: mergedPrefs,
    style_profile: nextStyle,
    grounding_facts: facts,
    trace: [`sales:product=${product.id}`]
  };
};
