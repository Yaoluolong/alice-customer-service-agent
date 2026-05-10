import { describe, it, expect } from "vitest";
import { detectPreference } from "../../src/utils/preference-detector";

describe("detectPreference", () => {
  it("detects '喜欢红色' (keyword + color)", () => {
    const result = detectPreference("我喜欢红色的包");
    expect(result).not.toBeNull();
    expect(result!.keyword).toBe("喜欢");
    expect(result!.entity).toBe("红色");
  });

  it("detects '不喜欢黑色' (negative keyword + color)", () => {
    const result = detectPreference("不喜欢黑色");
    expect(result).not.toBeNull();
    expect(result!.keyword).toBe("不喜欢");
  });

  it("detects English 'prefer M size'", () => {
    const result = detectPreference("I prefer M size");
    expect(result).not.toBeNull();
    expect(result!.keyword).toBe("prefer");
    expect(result!.entity).toBe("M");
  });

  it("detects brand preference '想要Chanel'", () => {
    const result = detectPreference("我想要Chanel的包");
    expect(result).not.toBeNull();
    expect(result!.entity).toMatch(/chanel/i);
  });

  it("detects style preference '偏好商务风格'", () => {
    const result = detectPreference("我偏好商务风格");
    expect(result).not.toBeNull();
    expect(result!.entity).toBe("商务");
  });

  it("detects 'love casual' in English", () => {
    const result = detectPreference("I love casual style bags");
    expect(result).not.toBeNull();
    expect(result!.keyword).toBe("love");
    expect(result!.entity).toBe("casual");
  });

  it("returns null for '喜欢你的服务' (keyword, no entity)", () => {
    expect(detectPreference("喜欢你的服务")).toBeNull();
  });

  it("returns null for '不要紧' (keyword fragment, no entity)", () => {
    expect(detectPreference("不要紧")).toBeNull();
  });

  it("returns null for plain text", () => {
    expect(detectPreference("你好")).toBeNull();
  });

  it("returns null for entity only without keyword", () => {
    expect(detectPreference("红色的那个多少钱")).toBeNull();
  });

  it("returns null for English without keyword", () => {
    expect(detectPreference("thanks for your help")).toBeNull();
  });
});
