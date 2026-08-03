import { describe, expect, it } from "vitest";
import { buildRevisionPrompt, buildSelectionPrompt } from "../src/ai/prompts.js";

describe("buildSelectionPrompt", () => {
  it("asks for structured title/body/takeaway fields", () => {
    const prompt = buildSelectionPrompt([{ title: "T", url: "https://example.com", description: "D", source: "SRF" }]);
    expect(prompt).toContain('"title"');
    expect(prompt).toContain('"body"');
    expect(prompt).toContain('"takeaway"');
    expect(prompt).toContain("https://example.com");
  });
});

describe("buildRevisionPrompt", () => {
  it("includes original, editor comment, source and image instruction", () => {
    const prompt = buildRevisionPrompt({ text: "Старий текст", sourceUrl: "https://example.com/news", imagePrompt: "Swiss train" }, "зроби коротше");
    expect(prompt).toContain("Старий текст");
    expect(prompt).toContain("зроби коротше");
    expect(prompt).toContain("https://example.com/news");
    expect(prompt).toContain("Swiss train");
    expect(prompt).toContain("regenerateImage");
    expect(prompt).toContain("<blockquote>");
  });
});
