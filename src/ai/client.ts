import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";
import type { GeneratedPost, NewsItem, Post } from "../types.js";
import { formatPostHtml, MAX_POST_TEXT_LENGTH, clampPostHtml, formatDraftCaption, maxPostTextForRevision } from "../bot/format-post.js";
import { logger } from "../logger.js";
import { buildRevisionPrompt, buildSelectPrompt, buildWritePrompt, enrichImagePrompt } from "./prompts.js";
import { imageUsageRecord, usageFromCompletion, type UsageRecord } from "./usage.js";

const selectSchema = z.object({
  accepted: z.boolean(),
  reason: z.string().default(""),
  selectedUrl: z.string().default(""),
  category: z.enum(["product", "useful_news", "business", "light", "skip"]).catch("useful_news")
});

const writeSchema = z.object({
  title: z.string().default(""),
  body: z.string().default(""),
  takeaway: z.string().default(""),
  cta: z.string().default(""),
  imagePrompt: z.string().default(""),
  category: z.enum(["product", "useful_news", "business", "light"]).catch("useful_news")
});

const revisionSchema = z.object({
  text: z.string().min(1).max(4000),
  imagePrompt: z.string().default(""),
  regenerateImage: z.boolean().default(false)
});

const MIN_BODY_CHARS = 480;
const MIN_BODY_PARAGRAPHS = 3;

function plainBodyStats(body: string): { paragraphs: number; chars: number } {
  const paragraphs = body.split(/\n+/).map((part) => part.trim()).filter(Boolean);
  const chars = body.replace(/\*\*|__/g, "").replace(/(?<!\*)\*(?!\*)/g, "").replace(/\s+/g, " ").trim().length;
  return { paragraphs: paragraphs.length, chars };
}

function isBodyTooShort(body: string): boolean {
  const stats = plainBodyStats(body);
  return stats.paragraphs < MIN_BODY_PARAGRAPHS || stats.chars < MIN_BODY_CHARS;
}

export class AiService {
  private client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  async selectStory(
    items: NewsItem[],
    recentTitles: string[] = []
  ): Promise<{ accepted: boolean; reason: string; item: NewsItem | null; category: GeneratedPost["category"]; usage: UsageRecord }> {
    const completion = await this.client.chat.completions.create({
      model: config.OPENAI_TEXT_MODEL,
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: buildSelectPrompt(items, recentTitles) }]
    });
    const usage = usageFromCompletion(config.OPENAI_TEXT_MODEL, completion.usage);
    const parsed = selectSchema.parse(JSON.parse(completion.choices[0]?.message.content ?? "{}"));
    const item = items.find((candidate) => candidate.url === parsed.selectedUrl) ?? null;
    const accepted = parsed.accepted && Boolean(item) && parsed.category !== "skip";
    return {
      accepted,
      reason: parsed.reason,
      item,
      category: parsed.category,
      usage
    };
  }

  private async requestWrite(
    item: NewsItem,
    sourceUrl: string,
    articleText: string | null,
    extraInstruction?: string
  ): Promise<{ parsed: z.infer<typeof writeSchema>; usage: UsageRecord }> {
    const base = buildWritePrompt(item, articleText, sourceUrl);
    const content = extraInstruction ? `${base}\n\nДОДАТКОВА ВИМОГА:\n${extraInstruction}` : base;
    const completion = await this.client.chat.completions.create({
      model: config.OPENAI_TEXT_MODEL,
      temperature: 0.65,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content }]
    });
    const usage = usageFromCompletion(config.OPENAI_TEXT_MODEL, completion.usage);
    const raw = JSON.parse(completion.choices[0]?.message.content ?? "{}") as Record<string, unknown>;
    if ((!raw.title || !raw.body) && typeof raw.text === "string") {
      const plain = String(raw.text);
      const [firstLine, ...rest] = plain.split("\n").map((line) => line.trim()).filter(Boolean);
      raw.title = raw.title || firstLine || "Новина зі Швейцарії";
      raw.body = raw.body || (rest.join("\n\n") || plain);
    }
    return { parsed: writeSchema.parse(raw), usage };
  }

  async writePost(
    item: NewsItem,
    sourceUrl: string,
    articleText: string | null,
    preferredCategory?: GeneratedPost["category"]
  ): Promise<{ generated: GeneratedPost; usage: UsageRecord }> {
    let { parsed, usage } = await this.requestWrite(item, sourceUrl, articleText);

    if (isBodyTooShort(parsed.body)) {
      logger.info({ chars: plainBodyStats(parsed.body).chars, paragraphs: plainBodyStats(parsed.body).paragraphs }, "Body too short — rewriting longer");
      const expanded = await this.requestWrite(
        item,
        sourceUrl,
        articleText,
        "Попередня версія була ЗАНАДТО КОРОТКА. Перепиши body: РІВНО 3 абзаци через \\n\\n, мінімум 550 символів. Абзац 1 — факти/цифри; абзац 2 — чому важливо; абзац 3 — що зробити. CTA окремим полем обов'язково."
      );
      usage = {
        ...usage,
        promptTokens: usage.promptTokens + expanded.usage.promptTokens,
        completionTokens: usage.completionTokens + expanded.usage.completionTokens,
        totalTokens: usage.totalTokens + expanded.usage.totalTokens,
        estimatedCostUsd: usage.estimatedCostUsd + expanded.usage.estimatedCostUsd
      };
      if (!isBodyTooShort(expanded.parsed.body) || plainBodyStats(expanded.parsed.body).chars > plainBodyStats(parsed.body).chars) {
        parsed = expanded.parsed;
      }
    }

    const category =
      preferredCategory && preferredCategory !== "skip"
        ? preferredCategory
        : parsed.category;
    const takeaway = (parsed.takeaway || "Збережіть собі й перевірте деталі в офіційному джерелі").slice(0, 140);
    const text = formatPostHtml({
      title: parsed.title.slice(0, 75),
      body: parsed.body.slice(0, 950),
      takeaway,
      cta: (parsed.cta || "Читайте деталі в джерелі та збережіть собі на майбутнє").slice(0, 120),
      sourceUrl,
      sourceLabel: `Джерело · ${item.source}`,
      category
    });
    if (text.length > MAX_POST_TEXT_LENGTH) throw new Error(`Generated caption exceeds Telegram limit: ${text.length}`);
    if (!parsed.title.trim() || !parsed.body.trim()) {
      return {
        generated: {
          accepted: false,
          reason: "empty title/body from writer",
          text: "",
          imagePrompt: "",
          category: "skip"
        },
        usage
      };
    }
    return {
      generated: {
        accepted: true,
        reason: "ok",
        text,
        imagePrompt: parsed.imagePrompt || "Cinematic everyday life moment in modern Switzerland",
        category
      },
      usage
    };
  }

  /** Back-compat helper used by older call sites/tests — select only, no article write. */
  async selectAndWrite(
    items: NewsItem[],
    recentTitles: string[] = []
  ): Promise<{ generated: GeneratedPost; item: NewsItem | null; usages: UsageRecord[] }> {
    const selected = await this.selectStory(items, recentTitles);
    if (!selected.accepted || !selected.item) {
      return {
        generated: {
          accepted: false,
          reason: selected.reason || "rejected",
          text: "",
          imagePrompt: "",
          category: selected.category
        },
        item: null,
        usages: [selected.usage]
      };
    }
    const written = await this.writePost(selected.item, selected.item.url, null, selected.category);
    return { generated: written.generated, item: selected.item, usages: [selected.usage, written.usage] };
  }

  async revise(post: Post, comment: string): Promise<{ text: string; imagePrompt: string; regenerateImage: boolean; usage: UsageRecord }> {
    const limit = maxPostTextForRevision(post.revisionCount);
    const completion = await this.client.chat.completions.create({
      model: config.OPENAI_TEXT_MODEL,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: buildRevisionPrompt(post, comment, limit) }]
    });
    const usage = usageFromCompletion(config.OPENAI_TEXT_MODEL, completion.usage);
    const parsed = revisionSchema.parse(JSON.parse(completion.choices[0]?.message.content ?? "{}"));
    let text = clampPostHtml(parsed.text.trim(), Math.min(MAX_POST_TEXT_LENGTH, limit));
    // Guarantee draft caption fits even if revisionCount display grows.
    let draftLen = formatDraftCaption(text, post.revisionCount + 1).length;
    while (draftLen > 1024 && text.length > 400) {
      text = clampPostHtml(text, text.length - 40);
      draftLen = formatDraftCaption(text, post.revisionCount + 1).length;
    }
    if (!text.trim()) throw new Error("Revision returned empty text");
    return {
      text,
      imagePrompt: parsed.imagePrompt || post.imagePrompt || "Cinematic everyday life moment in modern Switzerland",
      regenerateImage: parsed.regenerateImage,
      usage
    };
  }

  async generateImage(prompt: string): Promise<{ buffer: Buffer; usage: UsageRecord }> {
    const started = Date.now();
    const result = await this.client.images.generate({
      model: config.OPENAI_IMAGE_MODEL,
      prompt: enrichImagePrompt(prompt),
      size: "1536x1024",
      quality: "high"
    });
    const usage = imageUsageRecord(config.OPENAI_IMAGE_MODEL);
    const image = result.data?.[0];
    if (image?.b64_json) {
      logger.info({ ms: Date.now() - started }, "Image generated");
      return { buffer: Buffer.from(image.b64_json, "base64"), usage };
    }
    if (image?.url) {
      const response = await fetch(image.url);
      if (!response.ok) throw new Error(`Image download failed: ${response.status}`);
      logger.info({ ms: Date.now() - started }, "Image generated");
      return { buffer: Buffer.from(await response.arrayBuffer()), usage };
    }
    throw new Error("OpenAI returned no image data");
  }
}
