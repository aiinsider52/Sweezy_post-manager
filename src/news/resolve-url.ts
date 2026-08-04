import { logger } from "../logger.js";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

export const FEED_HEADERS: Record<string, string> = {
  "User-Agent": BROWSER_UA,
  Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.8",
  "Accept-Language": "de-CH,de;q=0.9,en;q=0.8"
};

function articleIdFromGoogleUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname.split("/");
    const idx = path.findIndex((part) => part === "articles" || part === "read");
    if (idx >= 0 && path[idx + 1]) return path[idx + 1]!;
  } catch {
    return null;
  }
  return null;
}

export { articleIdFromGoogleUrl };

async function getDecodingParams(articleId: string): Promise<{ signature: string; timestamp: string } | null> {
  for (const base of ["https://news.google.com/articles/", "https://news.google.com/rss/articles/"]) {
    try {
      const response = await fetch(`${base}${articleId}`, {
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9"
        },
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok) continue;
      const html = await response.text();
      const signature = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
      const timestamp = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
      if (signature && timestamp) return { signature, timestamp };
    } catch {
      // try next base URL
    }
  }
  return null;
}

async function decodeWithParams(articleId: string, signature: string, timestamp: string): Promise<string | null> {
  const payload = [
    "Fbv4je",
    `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${articleId}",${timestamp},"${signature}"]`
  ];
  const body = new URLSearchParams({ "f.req": JSON.stringify([[payload]]) });
  const response = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
    method: "POST",
    headers: {
      "User-Agent": BROWSER_UA,
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body,
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) return null;
  const text = await response.text();
  const chunk = text.split("\n\n")[1];
  if (!chunk) return null;
  const parsed = JSON.parse(chunk) as unknown[];
  const first = parsed[0] as unknown[];
  const encoded = first?.[2];
  if (typeof encoded !== "string") return null;
  const decoded = JSON.parse(encoded) as unknown[];
  const url = decoded[1];
  return typeof url === "string" && url.startsWith("http") ? url : null;
}

/** Decode Google News article links to the publisher URL. */
export async function resolveArticleUrl(url: string): Promise<string> {
  if (!url.includes("news.google.com")) return url;
  const articleId = articleIdFromGoogleUrl(url);
  if (!articleId) return url;

  try {
    const params = await getDecodingParams(articleId);
    if (!params) return url;
    const decoded = await decodeWithParams(articleId, params.signature, params.timestamp);
    if (decoded) return decoded;
  } catch (error) {
    logger.warn({ err: error, url }, "Google News URL resolve failed");
  }
  return url;
}
