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

/** Topic buckets used to avoid repeating the same editorial angle. */
export const TOPIC_BUCKETS: Array<{ id: string; pattern: RegExp }> = [
  { id: "transport", pattern: /\bö[vV]\b|\bsbb\b|tram|zug|bahn|verkehr|pendel|ticket|fahrplan|транспорт|поїзд|трамва|квитк/i },
  { id: "rules_status", pattern: /regel|vorschrift|schutzstatus|status\s*s|permit|bewilligung|asyl|aufenthalt|правил|дозвіл|статус/i },
  { id: "housing", pattern: /wohnung|miete|wohnungsnot|haushalt|житл|оренд/i },
  { id: "work", pattern: /arbeit|stelle|jobmarkt|arbeitsmarkt|lohn|робот|ваканс|зарплат/i },
  { id: "business", pattern: /startup|start-up|gründer|unternehmen|kmu|gmbh|firma|finanzierung|бізнес|стартап|компані/i },
  { id: "insurance_tax", pattern: /krankenversicherung|krankenkasse|prämie|steuer|страхов|податк|премі/i },
  { id: "school", pattern: /schule|kita|kinder|школ|дитсад/i },
  { id: "light", pattern: /kurios|absurd|skurril|ungewöhnlich|rekord|panne|смішн|курйоз|абсурд/i }
];

export function topicBucket(text: string): string {
  for (const bucket of TOPIC_BUCKETS) {
    if (bucket.pattern.test(text)) return bucket.id;
  }
  return "other";
}

function overlapPenalty(item: NewsItem, recentTitles: string[]): number {
  if (!recentTitles.length) return 0;
  const haystack = `${item.title}\n${item.description}`.toLowerCase();
  const bucket = topicBucket(haystack);
  let penalty = 0;

  for (const title of recentTitles) {
    const recentBucket = topicBucket(title);
    if (bucket !== "other" && bucket === recentBucket) penalty += 45;

    const tokens = title
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 5);
    let hits = 0;
    for (const token of tokens) {
      if (haystack.includes(token)) hits += 1;
    }
    if (hits >= 2) penalty += 30;
    else if (hits === 1) penalty += 10;
  }
  return penalty;
}

/**
 * Re-rank a shortlist so we don't keep serving the same topic as recent drafts.
 * Also round-robins topic buckets so the LLM sees a mixed catalog.
 */
export function diversifyCandidates(
  items: NewsItem[],
  recentTitles: string[],
  limit = 28,
  now = Date.now()
): NewsItem[] {
  const scored = items.map((item) => ({
    item,
    bucket: topicBucket(`${item.title}\n${item.description}`),
    score: scoreNewsItem(item, now) - overlapPenalty(item, recentTitles)
  }));
  scored.sort((a, b) => b.score - a.score);

  const byBucket = new Map<string, typeof scored>();
  for (const entry of scored) {
    const list = byBucket.get(entry.bucket) ?? [];
    list.push(entry);
    byBucket.set(entry.bucket, list);
  }

  const picked: NewsItem[] = [];
  const seen = new Set<string>();
  const order = [...byBucket.keys()].sort((a, b) => {
    // Prefer buckets that were NOT in recent posts.
    const aRecent = recentTitles.some((title) => topicBucket(title) === a) ? 1 : 0;
    const bRecent = recentTitles.some((title) => topicBucket(title) === b) ? 1 : 0;
    return aRecent - bRecent || a.localeCompare(b);
  });

  let progressed = true;
  while (picked.length < limit && progressed) {
    progressed = false;
    for (const bucket of order) {
      const list = byBucket.get(bucket);
      if (!list?.length) continue;
      const next = list.shift();
      if (!next || seen.has(next.item.url)) continue;
      seen.add(next.item.url);
      picked.push(next.item);
      progressed = true;
      if (picked.length >= limit) break;
    }
  }

  return picked;
}
