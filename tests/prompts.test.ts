import { describe, expect, it } from "vitest";
import { buildRevisionPrompt, buildSelectPrompt, buildWritePrompt, enrichImagePrompt } from "../src/ai/prompts.js";

describe("buildSelectPrompt", () => {
  it("asks only for story selection", () => {
    const prompt = buildSelectPrompt([{ title: "T", url: "https://example.com", description: "D", source: "SRF", publishedAt: "2026-08-04T08:00:00Z" }]);
    expect(prompt).toContain("Обери ОДИН");
    expect(prompt).toContain("selectedUrl");
    expect(prompt).not.toContain('"body"');
  });

  it("includes recent titles to avoid topic repeats", () => {
    const prompt = buildSelectPrompt(
      [{ title: "T", url: "https://example.com", description: "D", source: "SRF", publishedAt: "2026-08-04T08:00:00Z" }],
      ["ÖV правила квитків", "Schutzstatus S оновлення"]
    );
    expect(prompt).toContain("ÖV правила квитків");
    expect(prompt).toContain("НЕ ПОВТОРЮЙ");
  });
});

describe("buildWritePrompt", () => {
  it("asks for longer informative posts with rich markers", () => {
    const prompt = buildWritePrompt(
      { title: "T", url: "https://example.com", description: "D", source: "SRF" },
      "Full article text with numbers 12% and dates.",
      "https://example.com/article"
    );
    expect(prompt).toContain("РІВНО 3 абзаци");
    expect(prompt).toContain("550");
    expect(prompt).toContain("**жирний**");
    expect(prompt).toContain("__підкреслення__");
    expect(prompt).toContain("ЦЕПЛЯЮЧИЙ");
    expect(prompt).toContain("Full article text");
    expect(prompt).toContain("WOW");
  });
});

describe("buildRevisionPrompt", () => {
  it("keeps CTA and source structure", () => {
    const prompt = buildRevisionPrompt({ text: "Старий текст", sourceUrl: "https://example.com/news", imagePrompt: "Swiss train" }, "зроби коротше");
    expect(prompt).toContain("👉");
    expect(prompt).toContain("https://example.com/news");
    expect(prompt).toContain("regenerateImage");
    expect(prompt).toContain("<u>");
  });
});

describe("enrichImagePrompt", () => {
  it("adds cinematic wow constraints", () => {
    const prompt = enrichImagePrompt("Tram in Zurich at dusk");
    expect(prompt).toContain("Award-winning");
    expect(prompt).toContain("dramatic");
    expect(prompt).toContain("no text");
    expect(prompt).toContain("Tram in Zurich at dusk");
  });
});
