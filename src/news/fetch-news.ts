import Parser from "rss-parser";
import type { NewsItem } from "../types.js";
import { logger } from "../logger.js";
import { rankNews } from "./rank.js";

const feeds = [
  ["SRF News", "https://www.srf.ch/news/bnf/rss/1646"],
  ["SRF Wissen", "https://www.srf.ch/bnf/rss/630"],
  ["Blick", "https://www.blick.ch/schweiz/rss.xml"],
  ["NZZ", "https://www.nzz.ch/recent.rss"],
  ["Admin CH", "https://www.admin.ch/gov/de/start/dokumentation/medienmitteilungen.rss.html"],
  // Targeted Google News queries (when:2d keeps the pool fresh). Some regions return 503 — failures are non-fatal.
  ["GN Ukrainians CH", "https://news.google.com/rss/search?q=Ukrainians%20OR%20Ukraine%20Switzerland%20OR%20Schutzstatus%20when%3A2d&hl=en&gl=CH&ceid=CH%3Aen"],
  ["GN Schweiz Leben", "https://news.google.com/rss/search?q=Schweiz%20(Wohnung%20OR%20Miete%20OR%20Krankenkasse%20OR%20SBB%20OR%20Steuern%20OR%20Arbeit)%20when%3A2d&hl=de&gl=CH&ceid=CH%3Ade"],
  ["GN Schweiz Kurios", "https://news.google.com/rss/search?q=Schweiz%20(kurios%20OR%20skurril%20OR%20absurd%20OR%20Rekord)%20when%3A2d&hl=de&gl=CH&ceid=CH%3Ade"],
  ["GN Swissinfo", "https://news.google.com/rss/search?q=site%3Aswissinfo.ch%20when%3A2d&hl=en&gl=CH&ceid=CH%3Aen"],
  ["GN 20 Minuten", "https://news.google.com/rss/search?q=site%3A20min.ch%20Schweiz%20when%3A2d&hl=de&gl=CH&ceid=CH%3Ade"],
  ["GN Watson", "https://news.google.com/rss/search?q=site%3Awatson.ch%20when%3A2d&hl=de&gl=CH&ceid=CH%3Ade"]
] as const;

const parser = new Parser<Record<string, unknown>, { enclosure?: { url?: string }; media?: { content?: { url?: string } } }>({
  timeout: 12_000
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

async function resolveGoogleNewsUrl(url: string): Promise<string> {
  if (!url.includes("news.google.com")) return normalizeUrl(url);
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
      headers: { "User-Agent": "SweezyNewsBot/1.0" }
    });
    if (response.url && !response.url.includes("news.google.com")) return normalizeUrl(response.url);
  } catch {
    // Keep original Google URL; ranking/dedup still work.
  }
  return normalizeUrl(url);
}

async function fetchRss(source: string, url: string): Promise<NewsItem[]> {
  const feed = await parser.parseURL(url);
  const raw = feed.items.slice(0, 20).flatMap((item) => {
    if (!item.link || !item.title) return [];
    const imageUrl = item.enclosure?.url ?? item.media?.content?.url;
    return [{
      title: clean(item.title),
      url: item.link,
      description: clean(item.contentSnippet ?? item.content),
      source,
      ...(item.isoDate ? { publishedAt: item.isoDate } : {}),
      ...(imageUrl ? { imageUrl } : {})
    }];
  });

  return Promise.all(
    raw.map(async (item) => ({
      ...item,
      url: await resolveGoogleNewsUrl(item.url)
    }))
  );
}

async function fetchNewsApi(apiKey: string): Promise<NewsItem[]> {
  const queries = [
    '("Switzerland" OR Schweiz) AND (Ukraine OR Ukrainians OR Schutzstatus)',
    'Schweiz AND (Wohnung OR Krankenkasse OR SBB OR Integration OR Asyl)'
  ];
  const batches = await Promise.all(
    queries.map(async (query) => {
      const url =
        `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}` +
        `&language=de&sortBy=publishedAt&pageSize=25&from=${encodeURIComponent(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString())}` +
        `&apiKey=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
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
      const key = normalizeUrl(item.url);
      const existing = unique.get(key);
      if (!existing) {
        unique.set(key, { ...item, url: key });
        continue;
      }
      // Prefer the copy with a date / richer description.
      const preferNew =
        (!existing.publishedAt && item.publishedAt) ||
        ((item.description?.length ?? 0) > (existing.description?.length ?? 0));
      if (preferNew) unique.set(key, { ...item, url: key });
    }
  }

  const ranked = rankNews([...unique.values()]);
  logger.info({ fetched: unique.size, ranked: ranked.length }, "News pool ready");
  return ranked;
}
