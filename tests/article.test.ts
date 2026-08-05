import { describe, expect, it } from "vitest";
import { fetchArticleBody } from "../src/news/article.js";

describe("fetchArticleBody", () => {
  it("extracts readable text from simple HTML", async () => {
    const html = `<!doctype html><html><body><article>
      <h1>Hello</h1>
      <p>First paragraph with enough characters to pass the minimum threshold for article extraction logic.</p>
      <p>Second paragraph continues the story with more useful detail for the editorial model to consume.</p>
      <p>Third paragraph adds concrete numbers like 12% and a date 2026-08-01 for grounding.</p>
    </article></body></html>`;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(html, { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch;

    try {
      const body = await fetchArticleBody("https://example.com/news");
      expect(body).not.toBeNull();
      expect(body!.chars).toBeGreaterThan(180);
      expect(body!.text).toContain("12%");
      expect(body!.text).not.toContain("<p>");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
