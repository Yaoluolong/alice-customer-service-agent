export interface PreferenceDetection {
  keyword: string;
  entity: string;
  text: string;
}

// Longer/more-specific keywords first to avoid partial matches ("不喜欢" before "喜欢")
const PREFERENCE_KEYWORDS_ZH = ["不喜欢", "喜欢", "偏好", "想要", "不要", "讨厌"];
const PREFERENCE_KEYWORDS_EN = ["don't want", "prefer", "love", "hate", "like"];

const COLOR_PATTERNS =
  /红色|黑色|白色|蓝色|绿色|粉色|棕色|灰色|米色|金色|银色|red|black|white|blue|green|pink|brown|grey|gray|beige|gold|silver/i;
const SIZE_PATTERNS = /\b(XXXL|XXL|XL|L|M|S|XS)\b/i;
const BRAND_PATTERNS =
  /chanel|gucci|lv|louis vuitton|hermes|hermès|prada|dior|burberry|fendi|celine|céline|bottega|balenciaga|ysl|saint laurent/i;
const STYLE_PATTERNS =
  /商务|休闲|复古|简约|运动|正式|日常|vintage|casual|formal|sporty|minimalist|classic/i;

function findKeyword(text: string): string | null {
  const lower = text.toLowerCase();
  for (const kw of PREFERENCE_KEYWORDS_ZH) {
    if (text.includes(kw)) return kw;
  }
  for (const kw of PREFERENCE_KEYWORDS_EN) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

function findEntity(text: string): string | null {
  for (const pattern of [
    COLOR_PATTERNS,
    SIZE_PATTERNS,
    BRAND_PATTERNS,
    STYLE_PATTERNS,
  ]) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

export function detectPreference(text: string): PreferenceDetection | null {
  const keyword = findKeyword(text);
  if (!keyword) return null;
  const entity = findEntity(text);
  if (!entity) return null;
  return { keyword, entity, text };
}
