import { describe, expect, it } from "vitest";
import { CHANNEL_SIGNATURE, escapeHtml, formatDraftCaption, formatPostHtml, richTextToHtml } from "../src/bot/format-post.js";

describe("formatPostHtml", () => {
  it("builds a styled HTML caption with title, body, takeaway, CTA, source and signature", () => {
    const html = formatPostHtml({
      title: "Нові правила <B>permit>",
      body: "Перший абзац з **важливою цифрою**.\n\nДругий абзац з __підкресленням__.\n\nТретій з *курсивом*.",
      takeaway: "Перевірте умови на SEM",
      cta: "Збережіть собі і перечитайте перед візитом",
      sourceUrl: "https://example.com/a?x=1&y=2",
      sourceLabel: "Джерело · SRF",
      category: "useful_news"
    });

    expect(html).toContain("📌 <b>Нові правила &lt;B&gt;permit&gt;</b>");
    expect(html).toContain("<b>важливою цифрою</b>");
    expect(html).toContain("<u>підкресленням</u>");
    expect(html).toContain("<i>курсивом</i>");
    expect(html).toContain("<blockquote>💡 Перевірте умови на SEM</blockquote>");
    expect(html).toContain("👉 <b>Збережіть собі і перечитайте перед візитом</b>");
    expect(html).toContain('<a href="https://example.com/a?x=1&amp;y=2">Джерело · SRF</a>');
    expect(html).toContain(CHANNEL_SIGNATURE);
    expect(html.endsWith("🏹")).toBe(true);
  });

  it("uses business badge", () => {
    const html = formatPostHtml({
      title: "Стартап у Цюріху",
      body: "Компанія залучила фінансування.",
      takeaway: "Для фрілансерів це сигнал ринку",
      cta: "Подивіться деталі угоди в джерелі",
      sourceUrl: "https://example.com/biz",
      category: "business"
    });
    expect(html.startsWith("💼 <b>Стартап у Цюріху</b>")).toBe(true);
  });

  it("normalizes takeaway/cta prefixes", () => {
    const html = formatPostHtml({
      title: "Тест",
      body: "Текст.",
      takeaway: "💡 Будьте уважні ❞”",
      cta: "👉 Зробіть це",
      sourceUrl: "https://example.com/x",
      category: "useful_news"
    });
    expect(html).toContain("<blockquote>💡 Будьте уважні</blockquote>");
    expect(html).toContain("👉 <b>Зробіть це</b>");
    expect(html.match(/💡/g)?.length).toBe(1);
  });

  it("shrinks oversized captions but keeps takeaway quote", () => {
    const html = formatPostHtml({
      title: "Довгий заголовок про важливі правила для українців у Швейцарії",
      body: `${"Абзац один з деталями. ".repeat(40)}\n\n${"Абзац два з ще більшою кількістю тексту. ".repeat(40)}\n\n${"Абзац три. ".repeat(20)}`,
      takeaway: "Дуже довгий практичний висновок ".repeat(10),
      cta: "Зробіть важливу дію прямо зараз і збережіть",
      sourceUrl: "https://example.com/very/long/path/to/article?query=1&more=2",
      sourceLabel: "Джерело · SRF News Switzerland",
      category: "useful_news"
    });
    expect(html.length).toBeLessThanOrEqual(990);
    expect(html).toContain(CHANNEL_SIGNATURE);
    expect(html).toContain("<blockquote>💡");
  });
});

describe("richTextToHtml", () => {
  it("converts bold underline italic markers and escapes HTML", () => {
    expect(richTextToHtml("A **B<C>** and __D__ plus *E*")).toBe(
      "A <b>B&lt;C&gt;</b> and <u>D</u> plus <i>E</i>"
    );
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
