import type { GeneratedPost } from "../types.js";

const CATEGORY_BADGE: Record<GeneratedPost["category"], string> = {
  useful_news: "📌",
  light: "✨",
  product: "🚀",
  skip: "📰"
};

/** Leave room for the draft badge prefix in admin captions. */
export const MAX_POST_TEXT_LENGTH = 960;

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
  sourceUrl: string;
  sourceLabel?: string;
  category: GeneratedPost["category"];
}

function build(content: PostContent, includeTakeaway: boolean): string {
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
    blocks.push("", `<blockquote>💡 ${escapeHtml(takeaway)}</blockquote>`);
  }

  const label = escapeHtml((content.sourceLabel ?? "Джерело").trim() || "Джерело");
  blocks.push("", `🔗 <a href="${escapeHref(content.sourceUrl)}">${label}</a>`);
  return blocks.join("\n").trim();
}

/** Builds a Telegram HTML caption with a consistent editorial look. */
export function formatPostHtml(content: PostContent): string {
  let html = build(content, true);
  if (html.length <= MAX_POST_TEXT_LENGTH) return html;

  html = build(content, false);
  if (html.length <= MAX_POST_TEXT_LENGTH) return html;

  // Truncate body paragraphs until it fits.
  const paragraphs = content.body.split(/\n+/).map((part) => part.trim()).filter(Boolean);
  while (paragraphs.length > 1) {
    paragraphs.pop();
    html = build({ ...content, body: paragraphs.join("\n\n"), takeaway: "" }, false);
    if (html.length <= MAX_POST_TEXT_LENGTH) return html;
  }

  const title = content.title.trim().slice(0, 60);
  let body = (paragraphs[0] ?? "").slice(0, 420);
  html = build({ ...content, title, body, takeaway: "" }, false);
  while (html.length > MAX_POST_TEXT_LENGTH && body.length > 80) {
    body = body.slice(0, Math.max(80, body.length - 40));
    html = build({ ...content, title, body, takeaway: "" }, false);
  }
  return html;
}

export function formatDraftCaption(postText: string, revisionCount: number): string {
  return `📝 <b>ЧЕРНЕТКА</b> · ред. #${revisionCount + 1}\n\n${postText}`;
}

