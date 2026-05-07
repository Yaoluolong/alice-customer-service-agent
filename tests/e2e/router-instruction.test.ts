import { describe, it, expect } from "vitest";
import { buildRouterSystemPrompt } from "../../src/config/persona";

describe("buildRouterSystemPrompt with routerInstruction", () => {
  const soulPrompt = "You are a luxury bag consultant.";

  it("appends routerInstruction to the end of the prompt", async () => {
    const instruction = "当用户打招呼时优先分类为 product_inquiry";
    const prompt = await buildRouterSystemPrompt(soulPrompt, "zh-CN", instruction);

    expect(prompt).toContain(instruction);
    expect(prompt).toContain("Additional rules:");
    // Instruction should be at the end
    const instructionIndex = prompt.indexOf(instruction);
    expect(instructionIndex).toBeGreaterThan(prompt.indexOf("只输出一个意图"));
  });

  it("does not include Additional rules section when routerInstruction is undefined", async () => {
    const prompt = await buildRouterSystemPrompt(soulPrompt, "zh-CN");

    expect(prompt).not.toContain("Additional rules:");
  });

  it("does not include Additional rules section when routerInstruction is empty string", async () => {
    const prompt = await buildRouterSystemPrompt(soulPrompt, "zh-CN", "");

    expect(prompt).not.toContain("Additional rules:");
  });

  it("uses English router instruction when language is en-US", async () => {
    const instruction = "Prioritize product_inquiry for greetings";
    const prompt = await buildRouterSystemPrompt(soulPrompt, "en-US", instruction);

    expect(prompt).toContain(instruction);
    expect(prompt).toContain("Output exactly one intent");
  });
});
