import { describe, expect, it } from "vitest";
import { rankNews, scoreNewsItem } from "../src/news/rank.js";
import type { NewsItem } from "../src/types.js";

function item(partial: Partial<NewsItem> & Pick<NewsItem, "title" | "url">): NewsItem {
  return {
    description: "",
    source: "Test",
    ...partial
  };
}

describe("scoreNewsItem", () => {
  const now = Date.parse("2026-08-04T10:00:00Z");

  it("boosts fresh Ukrainian-Switzerland stories", () => {
    const ua = item({
      title: "Schutzstatus S: нові правила для українців у Швейцарії",
      url: "https://example.com/ua",
      description: "Зміни щодо дозволів на роботу",
      publishedAt: "2026-08-04T08:00:00Z"
    });
    const sports = item({
      title: "Fussball: Champions League highlights",
      url: "https://example.com/sport",
      publishedAt: "2026-08-04T09:00:00Z"
    });
    expect(scoreNewsItem(ua, now)).toBeGreaterThan(scoreNewsItem(sports, now));
  });
});

describe("rankNews", () => {
  const now = Date.parse("2026-08-04T10:00:00Z");

  it("drops stale items and sorts fresher relevant first", () => {
    const ranked = rankNews([
      item({
        title: "Стара політика без деталей",
        url: "https://example.com/old",
        publishedAt: "2026-07-01T10:00:00Z"
      }),
      item({
        title: "Schweiz Wohnung Miete steigt erneut",
        url: "https://example.com/rent",
        description: "Neue Zahlen zur Wohnungsnot",
        publishedAt: "2026-08-04T07:00:00Z",
        source: "NZZ"
      }),
      item({
        title: "Kurios: Rekord in Zürich",
        url: "https://example.com/light",
        publishedAt: "2026-08-03T20:00:00Z"
      })
    ], now);

    expect(ranked.map((entry) => entry.url)).toEqual([
      "https://example.com/rent",
      "https://example.com/light"
    ]);
  });
});
