import type { NewsItem } from "../types.js";

/** Prefer stories from the last 48 hours; softer penalty up to 72h. */
export const FRESH_MAX_AGE_MS = 48 * 60 * 60 * 1000;
export const HARD_MAX_AGE_MS = 72 * 60 * 60 * 1000;

const BOOST = [
  /ukrain/i,
  /schutzstatus\s*s/i,
  /flüchtling|geflüchtet|asyl/i,
  /aufenthalt|bewilligung|permit|ausländer/i,
  /integration|deutschkurs/i,
  /krankenversicherung|krankenkasse|prämie/i,
  /wohnung|miete|wohnungsnot|haushalt/i,
  /\bö[vV]\b|\bsbb\b|öbb|verkehr|pendel/i,
  /steuer|finanzen|budget|lohn/i,
  /arbeit|stelle|jobmarkt|arbeitsmarkt/i,
  /schule|kita|kinder/i,
  /kurios|absurd|skurril|ungewöhnlich|rekord|panne|missgeschick/i,
  /startup|start-up|gründer|unternehmen|kmu|selbständig|freelanc|gmbh|firma|geschäft|unternehm/i,
  /innovation|finanzierung|invest|venture/i,
  /schweiz|swiss|helvet/i,
  /zürich|zurich|genf|geneva|basel|bern|lausanne|luzern/i
];

const DEMOTE = [
  /fussball|football|eishockey|tennis|formel\s*1|champions\s*league/i,
  /promi|celebrity|royal|horoskop/i,
  /börse|aktien|kursziel/i,
  /wetterprognose|unwetterwarnung/i
];

export function ageMs(item: NewsItem, now = Date.now()): number | null {
  if (!item.publishedAt) return null;
  const ts = Date.parse(item.publishedAt);
  if (Number.isNaN(ts)) return null;
  return Math.max(0, now - ts);
}

export function isFreshEnough(item: NewsItem, now = Date.now()): boolean {
  const age = ageMs(item, now);
  if (age === null) return true; // keep undated; rank will deprioritize
  return age <= HARD_MAX_AGE_MS;
}

function keywordScore(text: string): number {
  let score = 0;
  for (const pattern of BOOST) if (pattern.test(text)) score += 14;
  for (const pattern of DEMOTE) if (pattern.test(text)) score -= 18;
  return score;
}

/** Higher is better. Used to shortlist candidates for the LLM. */
export function scoreNewsItem(item: NewsItem, now = Date.now()): number {
  const haystack = `${item.title}\n${item.description}\n${item.source}`;
  let score = keywordScore(haystack);

  const age = ageMs(item, now);
  if (age === null) {
    score -= 12;
  } else if (age <= 6 * 60 * 60 * 1000) {
    score += 55;
  } else if (age <= 24 * 60 * 60 * 1000) {
    score += 40;
  } else if (age <= FRESH_MAX_AGE_MS) {
    score += 25;
  } else if (age <= HARD_MAX_AGE_MS) {
    score += 8;
  } else {
    score -= 40;
  }

  if (item.description && item.description.length > 40) score += 6;
  if (/ukrain/i.test(haystack) && /schweiz|swiss|schutzstatus|aufenthalt/i.test(haystack)) score += 25;
  return score;
}

export function rankNews(items: NewsItem[], now = Date.now()): NewsItem[] {
  return items
    .filter((item) => isFreshEnough(item, now))
    .map((item) => ({ item, score: scoreNewsItem(item, now) }))
    .sort((a, b) => b.score - a.score || Date.parse(b.item.publishedAt ?? "0") - Date.parse(a.item.publishedAt ?? "0"))
    .map((entry) => entry.item);
}
