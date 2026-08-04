import type { GeneratedPost } from "../types.js";

const CATEGORY_BADGE: Record<GeneratedPost["category"], string> = {
  useful_news: "📌",
  business: "💼",
  light: "✨",
  product: "🚀",
  skip: "📰"
};

/** Leave room for the draft badge prefix in admin captions. */
export const MAX_POST_TEXT_LENGTH = 960;

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
    .replace(/\s*[❞"]\s*$/u, "")
    .trim();
  return `<blockquote>💡 ${escapeHtml(clean)}</blockquote>`;
}

function formatCtaLine(cta: string): string {
  const clean = cta.replace(/^👉\s*/u, "").trim();
  return `👉 <b>${escapeHtml(clean)}</b>`;
}

function build(content: PostContent, includeTakeaway: boolean, includeCta: boolean): string {
  const badge = CATEGORY_BADGE[content.category] ?? "📰";
  const title = escapeHtml(content.title.trim());
  const paragraphs = content.body
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => escapeHtml(part));

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
  let html = build(content, true, true);
  if (html.length <= MAX_POST_TEXT_LENGTH) return html;

  html = build(content, true, false);
  if (html.length <= MAX_POST_TEXT_LENGTH) return html;

  html = build(content, false, true);
  if (html.length <= MAX_POST_TEXT_LENGTH) return html;

  html = build(content, false, false);
  if (html.length <= MAX_POST_TEXT_LENGTH) return html;

  const paragraphs = content.body.split(/\n+/).map((part) => part.trim()).filter(Boolean);
  while (paragraphs.length > 1) {
    paragraphs.pop();
    const slim: PostContent = {
      ...content,
      body: paragraphs.join("\n\n"),
      takeaway: "",
      cta: content.cta ?? ""
    };
    html = build(slim, false, Boolean((slim.cta ?? "").trim()));
    if (html.length <= MAX_POST_TEXT_LENGTH) return html;
  }

  const title = content.title.trim().slice(0, 60);
  let body = (paragraphs[0] ?? "").slice(0, 320);
  html = build({ ...content, title, body, takeaway: "", cta: "" }, false, false);
  while (html.length > MAX_POST_TEXT_LENGTH && body.length > 80) {
    body = body.slice(0, Math.max(80, body.length - 40));
    html = build({ ...content, title, body, takeaway: "", cta: "" }, false, false);
  }
  return html;
}

export function formatDraftCaption(postText: string, revisionCount: number): string {
  return `📝 <b>ЧЕРНЕТКА</b> · ред. #${revisionCount + 1}\n\n${postText}`;
}
