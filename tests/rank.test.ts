import { describe, expect, it } from "vitest";
import { diversifyCandidates, rankNews, scoreNewsItem, topicBucket } from "../src/news/rank.js";
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

  it("boosts Swiss startup and business stories", () => {
    const biz = item({
      title: "Zürcher Startup erhält Millionen-Finanzierung",
      url: "https://example.com/biz",
      description: "Gründer aus dem KMU-Umfeld",
      publishedAt: "2026-08-04T09:00:00Z"
    });
    const bland = item({
      title: "Lokale Mitteilung ohne Bezug",
      url: "https://example.com/x",
      publishedAt: "2026-08-04T09:00:00Z"
    });
    expect(scoreNewsItem(biz, now)).toBeGreaterThan(scoreNewsItem(bland, now));
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

describe("diversifyCandidates", () => {
  const now = Date.parse("2026-08-04T10:00:00Z");

  it("mixes topic buckets and demotes recent transport themes", () => {
    const items = [
      item({
        title: "SBB ändert Fahrplan erneut",
        url: "https://example.com/train1",
        description: "ÖV Ticket Regeln",
        publishedAt: "2026-08-04T09:00:00Z"
      }),
      item({
        title: "Noch mehr ÖV Vorschriften",
        url: "https://example.com/train2",
        description: "Verkehr und Pendler",
        publishedAt: "2026-08-04T08:30:00Z"
      }),
      item({
        title: "Zürcher Startup erhält Finanzierung",
        url: "https://example.com/biz",
        description: "Gründer GmbH KMU",
        publishedAt: "2026-08-04T08:00:00Z"
      }),
      item({
        title: "Kurios: Rekordpanne in Bern",
        url: "https://example.com/funny",
        description: "Absurd und ungewöhnlich",
        publishedAt: "2026-08-04T07:00:00Z"
      })
    ];

    const mixed = diversifyCandidates(items, ["SBB Fahrplan ÖV Regeln"], 4, now);
    expect(mixed[0]?.url).not.toBe("https://example.com/train1");
    expect(mixed.map((entry) => entry.url)).toEqual(expect.arrayContaining([
      "https://example.com/biz",
      "https://example.com/funny"
    ]));
    expect(topicBucket("SBB Fahrplan")).toBe("transport");
  });
});
