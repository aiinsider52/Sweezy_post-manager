import type { GeneratedPost } from "../types.js";

const CATEGORY_BADGE: Record<GeneratedPost["category"], string> = {
  useful_news: "📌",
  business: "💼",
  light: "✨",
  product: "🚀",
  skip: "📰"
};

/** Leave room for the draft badge prefix in admin captions (~40 chars). Telegram caption max = 1024. */
export const MAX_POST_TEXT_LENGTH = 990;

export const CHANNEL_SIGNATURE =
  `🇨🇭 Sweezy — Life in Switzerland. Simplified.\n` +
  `<a href="https://t.me/sweezyxswiss">Sweezy</a> | <a href="https://sweezy.world">sweezy.world</a> | Manager <a href="https://t.me/vladyslavarcher">@vladyslavarcher</a> <a href="https://t.me/yuliiaarcher">@yuliiaarcher</a> 🏹`;

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeHref(url: string): string {
  return escapeHtml(url).replaceAll("'", "&#39;");
}

/**
 * Converts lightweight markers to Telegram HTML.
 * **bold** → <b>, __underline__ → <u>, *italic* → <i>
 */
export function richTextToHtml(input: string): string {
  const placeholders: string[] = [];
  const protect = (html: string) => {
    placeholders.push(html);
    return `\u0000${placeholders.length - 1}\u0000`;
  };

  let text = input;
  text = text.replace(/\*\*([^*]+)\*\*/g, (_, inner: string) => protect(`<b>${escapeHtml(inner)}</b>`));
  text = text.replace(/__([^_]+)__/g, (_, inner: string) => protect(`<u>${escapeHtml(inner)}</u>`));
  text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, inner: string) => protect(`<i>${escapeHtml(inner)}</i>`));
  text = escapeHtml(text);
  return text.replace(/\u0000(\d+)\u0000/g, (_, index: string) => placeholders[Number(index)] ?? "");
}

export interface PostContent {
  title: string;
  body: string;
  takeaway?: string;
  cta?: string;
  sourceUrl: string;
  sourceLabel?: string;
  category: GeneratedPost["category"];
}

function formatTakeawayBlock(takeaway: string): string {
  const clean = takeaway
    .replace(/^💡\s*/u, "")
    .replace(/^[❝„"”]\s*/u, "")
    .replace(/\s*[❞"”„❝]+\s*$/u, "")
    .replace(/[❝❞„]/gu, "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .trim();
  return `<blockquote>💡 ${escapeHtml(clean)}</blockquote>`;
}

function formatCtaLine(cta: string): string {
  const clean = cta.replace(/^👉\s*/u, "").replace(/\*\*/g, "").replace(/__/g, "").trim();
  return `👉 <b>${escapeHtml(clean)}</b>`;
}

function build(content: PostContent, includeTakeaway: boolean, includeCta: boolean): string {
  const badge = CATEGORY_BADGE[content.category] ?? "📰";
  const title = escapeHtml(content.title.trim());
  const paragraphs = content.body
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => richTextToHtml(part));

  const blocks: string[] = [`${badge} <b>${title}</b>`];
  if (paragraphs.length) blocks.push("", paragraphs.join("\n\n"));

  const takeaway = content.takeaway?.trim();
  if (includeTakeaway && takeaway) {
    blocks.push("", formatTakeawayBlock(takeaway));
  }

  const cta = content.cta?.trim();
  if (includeCta && cta) {
    blocks.push("", formatCtaLine(cta));
  }

  const label = escapeHtml((content.sourceLabel ?? "Джерело").trim() || "Джерело");
  blocks.push("", `🔗 <a href="${escapeHref(content.sourceUrl)}">${label}</a>`);
  blocks.push("", CHANNEL_SIGNATURE);
  return blocks.join("\n").trim();
}

/** Builds a Telegram HTML caption with a consistent editorial look. */
export function formatPostHtml(content: PostContent): string {
  const takeaway = content.takeaway?.trim() ?? "";

  let html = build(content, true, true);
  if (html.length <= MAX_POST_TEXT_LENGTH) return html;

  html = build(content, Boolean(takeaway), false);
  if (html.length <= MAX_POST_TEXT_LENGTH) return html;

  const paragraphs = content.body.split(/\n+/).map((part) => part.trim()).filter(Boolean);
  while (paragraphs.length > 1) {
    paragraphs.pop();
    const slim: PostContent = {
      ...content,
      body: paragraphs.join("\n\n"),
      cta: ""
    };
    html = build(slim, Boolean(takeaway), false);
    if (html.length <= MAX_POST_TEXT_LENGTH) return html;
  }

  let body = (paragraphs[0] ?? "").slice(0, 400);
  let title = content.title.trim().slice(0, 70);
  let tip = takeaway.slice(0, 120);
  html = build({ ...content, title, body, takeaway: tip, cta: "" }, Boolean(tip), false);
  while (html.length > MAX_POST_TEXT_LENGTH) {
    if (body.length > 100) {
      body = body.slice(0, Math.max(100, body.length - 40));
    } else if (tip.length > 40) {
      tip = tip.slice(0, Math.max(40, tip.length - 20));
    } else if (title.length > 30) {
      title = title.slice(0, Math.max(30, title.length - 10));
    } else {
      break;
    }
    html = build({ ...content, title, body, takeaway: tip, cta: "" }, Boolean(tip), false);
  }
  return html;
}

export function formatDraftCaption(postText: string, revisionCount: number): string {
  return `📝 <b>ЧЕРНЕТКА</b> · ред. #${revisionCount + 1}\n\n${postText}`;
}
