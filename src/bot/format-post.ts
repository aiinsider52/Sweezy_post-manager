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

/** Max length of post HTML so draft badge + text still fits Telegram's 1024 caption limit. */
export function maxPostTextForRevision(revisionCount: number): number {
  const prefixLen = formatDraftCaption("", revisionCount + 1).length;
  return Math.max(600, 1024 - prefixLen);
}

/**
 * Soft-trim an already-built HTML caption to fit Telegram limits,
 * preferring to keep signature, source and takeaway.
 */
export function clampPostHtml(html: string, maxLength = MAX_POST_TEXT_LENGTH): string {
  let text = html.trim();
  if (text.length <= maxLength) return text;

  const signatureIdx = text.lastIndexOf("🇨🇭");
  const signature = signatureIdx >= 0 ? text.slice(signatureIdx).trim() : CHANNEL_SIGNATURE;
  let head = signatureIdx >= 0 ? text.slice(0, signatureIdx).trimEnd() : text;

  const pullTail = (pattern: RegExp): string => {
    const match = head.match(pattern);
    if (!match) return "";
    head = head.slice(0, head.length - match[0].length).trimEnd();
    return match[0].trim();
  };

  const source = pullTail(/\n🔗 [\s\S]*$/);
  const takeaway = pullTail(/\n<blockquote>[\s\S]*?<\/blockquote>\s*$/);
  const cta = pullTail(/\n👉 [\s\S]*$/);

  const rebuild = (body: string, includeCta: boolean): string => {
    const blocks = [body.trim()];
    if (takeaway) blocks.push(takeaway);
    if (includeCta && cta) blocks.push(cta);
    if (source) blocks.push(source);
    blocks.push(signature);
    return blocks.join("\n\n").trim();
  };

  const paragraphs = head.split(/\n\n+/).map((part) => part.trim()).filter(Boolean);
  while (paragraphs.length > 1) {
    const candidate = rebuild(paragraphs.join("\n\n"), true);
    if (candidate.length <= maxLength) return candidate;
    // Keep title (first block), drop last body paragraph.
    paragraphs.pop();
  }

  let body = paragraphs[0] ?? head;
  let candidate = rebuild(body, false);
  while (candidate.length > maxLength && body.length > 120) {
    body = body.slice(0, Math.max(120, body.length - 50));
    const cut = body.lastIndexOf(" ");
    if (cut > 100) body = body.slice(0, cut);
    body = body.replace(/<[^>]*$/u, "").trim();
    candidate = rebuild(body, false);
  }

  return candidate.length <= maxLength ? candidate : candidate.slice(0, maxLength);
}
