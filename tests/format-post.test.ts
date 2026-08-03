import { describe, expect, it } from "vitest";
import { CHANNEL_SIGNATURE, escapeHtml, formatDraftCaption, formatPostHtml } from "../src/bot/format-post.js";

describe("formatPostHtml", () => {
  it("builds a styled HTML caption with title, body, takeaway, source and channel signature", () => {
    const html = formatPostHtml({
      title: "Нові правила <B>permit>",
      body: "Перший абзац.\n\nДругий абзац з деталями.",
      takeaway: "Перевірте умови на SEM",
      sourceUrl: "https://example.com/a?x=1&y=2",
      sourceLabel: "Джерело · SRF",
      category: "useful_news"
    });

    expect(html).toContain("📌 <b>Нові правила &lt;B&gt;permit&gt;</b>");
    expect(html).toContain("Перший абзац.");
    expect(html).toContain("Другий абзац з деталями.");
    expect(html).toContain("<blockquote>💡 Перевірте умови на SEM</blockquote>");
    expect(html).toContain('<a href="https://example.com/a?x=1&amp;y=2">Джерело · SRF</a>');
    expect(html).toContain(CHANNEL_SIGNATURE);
    expect(html.endsWith("🏹")).toBe(true);
    expect(html).not.toContain("Джерело:");
  });

  it("uses light badge and skips empty takeaway", () => {
    const html = formatPostHtml({
      title: "Сирний день",
      body: "У Цюріху знову черга за fondue.",
      takeaway: "   ",
      sourceUrl: "https://example.com/light",
      category: "light"
    });
    expect(html.startsWith("✨ <b>Сирний день</b>")).toBe(true);
    expect(html).not.toContain("<blockquote>");
    expect(html).toContain(CHANNEL_SIGNATURE);
  });

  it("shrinks oversized captions to Telegram-safe length and keeps signature", () => {
    const html = formatPostHtml({
      title: "Довгий заголовок про важливі правила для українців у Швейцарії",
      body: `${"Абзац один з деталями. ".repeat(40)}\n\n${"Абзац два з ще більшою кількістю тексту. ".repeat(40)}`,
      takeaway: "Дуже довгий практичний висновок ".repeat(10),
      sourceUrl: "https://example.com/very/long/path/to/article?query=1&more=2",
      sourceLabel: "Джерело · SRF News Switzerland",
      category: "useful_news"
    });
    expect(html.length).toBeLessThanOrEqual(960);
    expect(html).toContain("<b>");
    expect(html).toContain(CHANNEL_SIGNATURE);
  });
});

describe("formatDraftCaption", () => {
  it("wraps post with HTML draft badge", () => {
    expect(formatDraftCaption("<b>Hi</b>", 0)).toBe("📝 <b>ЧЕРНЕТКА</b> · ред. #1\n\n<b>Hi</b>");
  });
});

describe("escapeHtml", () => {
  it("escapes reserved characters", () => {
    expect(escapeHtml(`A & B <C> "D"`)).toBe("A &amp; B &lt;C&gt; &quot;D&quot;");
  });
});
