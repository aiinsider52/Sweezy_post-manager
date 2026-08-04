import { describe, expect, it } from "vitest";
import { buildRevisionPrompt, buildSelectionPrompt } from "../src/ai/prompts.js";

describe("buildSelectionPrompt", () => {
  it("asks for structured title/body/takeaway fields and prioritizes fresh useful stories", () => {
    const prompt = buildSelectionPrompt([{ title: "T", url: "https://example.com", description: "D", source: "SRF", publishedAt: "2026-08-04T08:00:00Z" }]);
    expect(prompt).toContain('"title"');
    expect(prompt).toContain('"body"');
    expect(prompt).toContain('"takeaway"');
    expect(prompt).toContain("https://example.com");
    expect(prompt).toContain("статус S");
    expect(prompt).toContain("publishedAt");
    expect(prompt).toContain("вау-ефектом");
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
