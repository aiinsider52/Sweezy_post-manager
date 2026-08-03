import type { GeneratedPost } from "../types.js";

const CATEGORY_BADGE: Record<GeneratedPost["category"], string> = {
  useful_news: "📌",
  light: "✨",
  product: "🚀",
  skip: "📰"
};

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

/** Builds a Telegram HTML caption with a consistent editorial look. */
export function formatPostHtml(content: PostContent): string {
  const badge = CATEGORY_BADGE[content.category] ?? "📰";
  const title = escapeHtml(content.title.trim());
  const paragraphs = content.body
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => escapeHtml(part));

  const blocks: string[] = [`${badge} <b>${title}</b>`, ""];
  if (paragraphs.length) blocks.push(paragraphs.join("\n\n"));

  const takeaway = content.takeaway?.trim();
  if (takeaway) {
    blocks.push("", `<blockquote>💡 ${escapeHtml(takeaway)}</blockquote>`);
  }

  const label = escapeHtml((content.sourceLabel ?? "Джерело").trim() || "Джерело");
  blocks.push("", `🔗 <a href="${escapeHref(content.sourceUrl)}">${label}</a>`);

  return blocks.join("\n").trim();
}

export function formatDraftCaption(postText: string, revisionCount: number): string {
  return `📝 <b>ЧЕРНЕТКА</b> · ред. #${revisionCount + 1}\n\n${postText}`;
}
