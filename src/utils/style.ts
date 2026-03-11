import { StyleProfile, UserTone } from "../types";

export const detectUserTone = (text: string): UserTone => {
  const normalized = text.toLowerCase();

  if (/快点|马上|尽快|急|asap|urgent|right now/.test(normalized)) {
    return "urgent";
  }
  if (/怎么|为什么|不明白|help|how|what|\?/.test(normalized)) {
    return "confused";
  }
  if (/谢谢|麻烦|请|thanks|please/.test(normalized)) {
    return "polite";
  }
  if (/简短|简单说|一句话|short|brief/.test(normalized)) {
    return "brief";
  }
  return "neutral";
};

export const updateStyleProfileFromUserText = (profile: StyleProfile, text: string): StyleProfile => {
  const normalized = text.toLowerCase();
  const next: StyleProfile = { ...profile };

  if (/简短|简单说|一句话|short|brief/.test(normalized)) {
    next.verbosity = "short";
  }
  if (/详细|展开|具体|detail|more details/.test(normalized)) {
    next.verbosity = "detailed";
  }
  if (/正式|professional|formally/.test(normalized)) {
    next.formality = "formal";
  }
  if (/轻松|随意|casual/.test(normalized)) {
    next.formality = "casual";
  }
  if (/叫我\s*([\u4e00-\u9fffA-Za-z0-9_]{2,12})/.test(text)) {
    const hit = text.match(/叫我\s*([\u4e00-\u9fffA-Za-z0-9_]{2,12})/);
    if (hit?.[1]) {
      next.addressStyle = hit[1];
    }
  }

  return next;
};

export const defaultStyleProfile = (): StyleProfile => ({
  addressStyle: "你",
  verbosity: "normal",
  formality: "neutral",
  warmth: 0.7
});
