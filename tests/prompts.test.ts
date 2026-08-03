import { describe, expect, it } from "vitest";
import { buildRevisionPrompt } from "../src/ai/prompts.js";

describe("buildRevisionPrompt", () => {
  it("includes original, editor comment, source and image instruction", () => {
    const prompt = buildRevisionPrompt({ text: "Старий текст", sourceUrl: "https://example.com/news", imagePrompt: "Swiss train" }, "зроби коротше");
    expect(prompt).toContain("Старий текст");
    expect(prompt).toContain("зроби коротше");
    expect(prompt).toContain("https://example.com/news");
    expect(prompt).toContain("Swiss train");
    expect(prompt).toContain("regenerateImage");
  });
});
