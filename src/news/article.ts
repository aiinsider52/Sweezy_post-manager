import { FEED_HEADERS } from "./resolve-url.js";
import { logger } from "../logger.js";

const MAX_CHARS = 7000;

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|h[1-6]|li|br|tr|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractMainHtml(html: string): string {
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  if (article && article.length > 400) return article;

  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  if (main && main.length > 400) return main;

  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => match[0])
    .filter((block) => stripTags(block).length > 40);
  if (paragraphs.length >= 2) return paragraphs.slice(0, 40).join("\n");

  return html;
}

export interface ArticleBody {
  text: string;
  chars: number;
}

/** Best-effort article body extraction for LLM context. */
export async function fetchArticleBody(url: string): Promise<ArticleBody | null> {
  try {
    const response = await fetch(url, {
      headers: FEED_HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(14_000)
    });
    if (!response.ok) {
      logger.warn({ url, status: response.status }, "Article fetch failed");
      return null;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!/html|text|xml/i.test(contentType) && contentType) {
      logger.warn({ url, contentType }, "Article fetch skipped: non-HTML");
      return null;
    }
    const html = await response.text();
    const text = stripTags(extractMainHtml(html)).slice(0, MAX_CHARS);
    if (text.length < 180) {
      logger.info({ url, chars: text.length }, "Article body too short");
      return null;
    }
    return { text, chars: text.length };
  } catch (error) {
    logger.warn({ err: error, url }, "Article fetch error");
    return null;
  }
}
