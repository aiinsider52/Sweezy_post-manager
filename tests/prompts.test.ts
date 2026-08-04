import { describe, expect, it } from "vitest";
import { buildRevisionPrompt, buildSelectionPrompt, enrichImagePrompt } from "../src/ai/prompts.js";

describe("buildSelectionPrompt", () => {
  it("requires concrete facts, CTA, business and light topics", () => {
    const prompt = buildSelectionPrompt([{ title: "T", url: "https://example.com", description: "D", source: "SRF", publishedAt: "2026-08-04T08:00:00Z" }]);
    expect(prompt).toContain('"cta"');
    expect(prompt).toContain("бізнес");
    expect(prompt).toContain("Казусні");
    expect(prompt).toContain("КОНКРЕТИКИ");
    expect(prompt).toContain("business");
    expect(prompt).toContain("статус S");
  });
});

describe("buildRevisionPrompt", () => {
  it("keeps CTA and source structure", () => {
    const prompt = buildRevisionPrompt({ text: "Старий текст", sourceUrl: "https://example.com/news", imagePrompt: "Swiss train" }, "зроби коротше");
    expect(prompt).toContain("👉");
    expect(prompt).toContain("https://example.com/news");
    expect(prompt).toContain("regenerateImage");
  });
});

describe("enrichImagePrompt", () => {
  it("adds photorealistic constraints", () => {
    const prompt = enrichImagePrompt("Tram in Zurich at dusk");
    expect(prompt).toContain("Photorealistic");
    expect(prompt).toContain("no text");
    expect(prompt).toContain("Tram in Zurich at dusk");
  });
});
