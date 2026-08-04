import Parser from "rss-parser";
import type { NewsItem } from "../types.js";
import { logger } from "../logger.js";
import { rankNews } from "./rank.js";

/** Direct Swiss feeds only — Google News from Render often 503s and wastes timeout budget. */
const feeds = [
  ["SRF News", "https://www.srf.ch/news/bnf/rss/1646"],
  ["SRF Wissen", "https://www.srf.ch/bnf/rss/630"],
  ["Blick", "https://www.blick.ch/schweiz/rss.xml"],
  ["NZZ", "https://www.nzz.ch/recent.rss"]
] as const;

const parser = new Parser<Record<string, unknown>, { enclosure?: { url?: string }; media?: { content?: { url?: string } } }>({
  timeout: 8_000
});

function clean(value: string | undefined): string {
  return (value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_") || key === "fbclid" || key === "guccounter") url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return raw.split("#")[0] ?? raw;
  }
}

async function fetchRss(source: string, url: string): Promise<NewsItem[]> {
  const feed = await parser.parseURL(url);
  return feed.items.slice(0, 20).flatMap((item) => {
    if (!item.link || !item.title) return [];
    const imageUrl = item.enclosure?.url ?? item.media?.content?.url;
    return [{
      title: clean(item.title),
      url: normalizeUrl(item.link),
      description: clean(item.contentSnippet ?? item.content),
      source,
      ...(item.isoDate ? { publishedAt: item.isoDate } : {}),
      ...(imageUrl ? { imageUrl } : {})
    }];
  });
}

async function fetchNewsApi(apiKey: string): Promise<NewsItem[]> {
  const queries = [
    '("Switzerland" OR Schweiz) AND (Ukraine OR Ukrainians OR Schutzstatus)',
    "Schweiz AND (Wohnung OR Krankenkasse OR SBB OR Integration OR Asyl OR kurios)"
  ];
  const from = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const batches = await Promise.all(
    queries.map(async (query) => {
      const url =
        `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}` +
        `&language=de&sortBy=publishedAt&pageSize=25&from=${encodeURIComponent(from)}` +
        `&apiKey=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`NewsAPI ${response.status}`);
      const json = await response.json() as {
        articles?: Array<{
          title?: string;
          url?: string;
          description?: string;
          publishedAt?: string;
          urlToImage?: string;
          source?: { name?: string };
        }>;
      };
      return (json.articles ?? []).flatMap((item) =>
        item.title && item.url
          ? [{
              title: item.title,
              url: normalizeUrl(item.url),
              description: item.description ?? "",
              source: item.source?.name ?? "NewsAPI",
              ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
              ...(item.urlToImage ? { imageUrl: item.urlToImage } : {})
            }]
          : []
      );
    })
  );
  return batches.flat();
}

export async function fetchNews(newsApiKey?: string): Promise<NewsItem[]> {
  const started = Date.now();
  const jobs: Array<Promise<NewsItem[]>> = feeds.map(([name, url]) => fetchRss(name, url));
  if (newsApiKey) jobs.push(fetchNewsApi(newsApiKey));

  const results = await Promise.allSettled(jobs);
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      logger.warn({ err: result.reason, source: index < feeds.length ? feeds[index]?.[0] : "NewsAPI" }, "News source failed");
    }
  });

  const unique = new Map<string, NewsItem>();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const item of result.value) {
      const key = item.url;
      const existing = unique.get(key);
      if (!existing) {
        unique.set(key, item);
        continue;
      }
      const preferNew =
        (!existing.publishedAt && item.publishedAt) ||
        ((item.description?.length ?? 0) > (existing.description?.length ?? 0));
      if (preferNew) unique.set(key, item);
    }
  }

  const ranked = rankNews([...unique.values()]);
  logger.info({ fetched: unique.size, ranked: ranked.length, ms: Date.now() - started }, "News pool ready");
  return ranked;
}
