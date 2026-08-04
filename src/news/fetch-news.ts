import Parser from "rss-parser";
import type { NewsItem } from "../types.js";
import { logger } from "../logger.js";
import { rankNews } from "./rank.js";
import { FEED_HEADERS, resolveArticleUrl } from "./resolve-url.js";

const feeds = [
  ["SRF News", "https://www.srf.ch/news/bnf/rss/1646"],
  ["SRF Wissen", "https://www.srf.ch/bnf/rss/630"],
  ["NZZ", "https://www.nzz.ch/recent.rss"],
  ["Watson", "https://www.watson.ch/api/1.0/rss.xml"],
  // Official Swiss federal media releases (News Service Bund) — not the blocked admin.ch HTML RSS path
  ["Admin CH", "https://www.newsd.admin.ch/newsd/feeds/rss?lang=de&org-nr=1&kind=M"],
  ["SEM Admin", "https://www.newsd.admin.ch/newsd/feeds/rss?lang=de&org-nr=405&kind=M"],
  // Google News with browser UA
  ["GN Ukrainians CH", "https://news.google.com/rss/search?q=Ukrainians%20OR%20Ukraine%20Switzerland%20OR%20Schutzstatus%20when%3A2d&hl=en&gl=CH&ceid=CH%3Aen"],
  ["GN Schweiz Leben", "https://news.google.com/rss/search?q=Schweiz%20(Wohnung%20OR%20Miete%20OR%20Krankenkasse%20OR%20SBB%20OR%20Steuern%20OR%20Arbeit%20OR%20Asyl)%20when%3A2d&hl=de&gl=CH&ceid=CH%3Ade"],
  ["GN Schweiz Kurios", "https://news.google.com/rss/search?q=Schweiz%20(kurios%20OR%20skurril%20OR%20absurd%20OR%20Rekord)%20when%3A2d&hl=de&gl=CH&ceid=CH%3Ade"],
  ["GN Swissinfo", "https://news.google.com/rss/search?q=site%3Aswissinfo.ch%20when%3A2d&hl=en&gl=CH&ceid=CH%3Aen"],
  ["GN 20 Minuten", "https://news.google.com/rss/search?q=site%3A20min.ch%20Schweiz%20when%3A2d&hl=de&gl=CH&ceid=CH%3Ade"],
  ["GN Blick", "https://news.google.com/rss/search?q=site%3Ablick.ch%20Schweiz%20when%3A2d&hl=de&gl=CH&ceid=CH%3Ade"]
] as const;

type RssItem = {
  title?: string;
  link?: string;
  contentSnippet?: string;
  content?: string;
  isoDate?: string;
  pubDate?: string;
  enclosure?: { url?: string };
  source?: { url?: string; _?: string } | string;
};

const parser = new Parser<Record<string, unknown>, RssItem>({
  customFields: {
    item: [["source", "source", { keepArray: false }]]
  }
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

function sourceLabel(item: RssItem, fallback: string): string {
  if (typeof item.source === "string" && item.source.trim()) return item.source.trim();
  if (item.source && typeof item.source === "object") {
    const text = (item.source._ ?? "").trim();
    if (text) return text;
  }
  return fallback;
}

async function fetchRss(source: string, url: string): Promise<NewsItem[]> {
  const response = await fetch(url, {
    headers: FEED_HEADERS,
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error(`Status code ${response.status}`);
  const xml = await response.text();
  const feed = await parser.parseString(xml);
  return (feed.items as RssItem[]).slice(0, 20).flatMap((item) => {
    if (!item.link || !item.title) return [];
    const publishedAt = item.isoDate ?? (item.pubDate ? new Date(item.pubDate).toISOString() : undefined);
    const imageUrl = item.enclosure?.url;
    return [{
      title: clean(item.title),
      url: normalizeUrl(item.link),
      description: clean(item.contentSnippet ?? item.content),
      source: sourceLabel(item, source),
      ...(publishedAt && !Number.isNaN(Date.parse(publishedAt)) ? { publishedAt } : {}),
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
      const endpoint =
        `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}` +
        `&language=de&sortBy=publishedAt&pageSize=25&from=${encodeURIComponent(from)}` +
        `&apiKey=${encodeURIComponent(apiKey)}`;
      const response = await fetch(endpoint, {
        signal: AbortSignal.timeout(10_000),
        headers: FEED_HEADERS
      });
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

async function mapPool<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

async function resolveTopUrls(items: NewsItem[], limit = 15): Promise<NewsItem[]> {
  const head = items.slice(0, limit);
  const rest = items.slice(limit);
  const resolved = await mapPool(head, 3, async (item) => {
    if (!item.url.includes("news.google.com")) return item;
    const url = normalizeUrl(await resolveArticleUrl(item.url));
    return { ...item, url };
  });
  return [...resolved, ...rest];
}

export async function fetchNews(newsApiKey?: string): Promise<NewsItem[]> {
  const started = Date.now();
  const jobs: Array<Promise<NewsItem[]>> = feeds.map(([name, url]) => fetchRss(name, url));
  if (newsApiKey) jobs.push(fetchNewsApi(newsApiKey));

  const results = await Promise.allSettled(jobs);
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      logger.warn({ err: result.reason, source: index < feeds.length ? feeds[index]?.[0] : "NewsAPI" }, "News source failed");
    } else {
      logger.info({ source: index < feeds.length ? feeds[index]?.[0] : "NewsAPI", count: result.value.length }, "News source ok");
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
  const withRealUrls = await resolveTopUrls(ranked, 15);
  const ordered: NewsItem[] = [];
  const seen = new Set<string>();
  for (const item of withRealUrls) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    ordered.push(item);
  }

  logger.info({
    fetched: unique.size,
    ranked: ranked.length,
    realLinks: ordered.slice(0, 15).filter((i) => !i.url.includes("news.google.com")).length,
    ms: Date.now() - started
  }, "News pool ready");
  return ordered;
}
