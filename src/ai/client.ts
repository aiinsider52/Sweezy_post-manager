import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";
import type { GeneratedPost, NewsItem, Post } from "../types.js";
import { formatPostHtml, MAX_POST_TEXT_LENGTH } from "../bot/format-post.js";
import { logger } from "../logger.js";
import { buildRevisionPrompt, buildSelectionPrompt } from "./prompts.js";

const selectionSchema = z.object({
  accepted: z.boolean(),
  reason: z.string().default(""),
  selectedUrl: z.string().default(""),
  title: z.string().default(""),
  body: z.string().default(""),
  takeaway: z.string().default(""),
  imagePrompt: z.string().default(""),
  category: z.enum(["product", "useful_news", "light", "skip"]).catch("useful_news")
});
const revisionSchema = z.object({ text: z.string().min(1).max(MAX_POST_TEXT_LENGTH), imagePrompt: z.string(), regenerateImage: z.boolean() });

export class AiService {
  private client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  async selectAndWrite(items: NewsItem[]): Promise<{ generated: GeneratedPost; item: NewsItem | null }> {
    const completion = await this.client.chat.completions.create({
      model: config.OPENAI_TEXT_MODEL,
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: buildSelectionPrompt(items) }]
    });
    const raw = JSON.parse(completion.choices[0]?.message.content ?? "{}") as Record<string, unknown>;
    // Back-compat if model still returns a single "text" field.
    if ((!raw.title || !raw.body) && typeof raw.text === "string") {
      const plain = String(raw.text);
      const [firstLine, ...rest] = plain.split("\n").map((line) => line.trim()).filter(Boolean);
      raw.title = raw.title || firstLine || "Новина зі Швейцарії";
      raw.body = raw.body || (rest.join("\n\n") || plain);
    }
    const parsed = selectionSchema.parse(raw);
    const item = items.find((candidate) => candidate.url === parsed.selectedUrl) ?? null;
    const accepted = parsed.accepted && Boolean(item) && Boolean(parsed.title.trim()) && Boolean(parsed.body.trim());
    const text = accepted && item
      ? formatPostHtml({
          title: parsed.title.slice(0, 70),
          body: parsed.body.slice(0, 650),
          takeaway: parsed.takeaway.slice(0, 120),
          sourceUrl: item.url,
          sourceLabel: `Джерело · ${item.source}`,
          category: parsed.category === "skip" ? "useful_news" : parsed.category
        })
      : "";
    if (text.length > MAX_POST_TEXT_LENGTH) throw new Error(`Generated caption exceeds Telegram limit: ${text.length}`);
    return {
      generated: {
        accepted,
        reason: parsed.reason,
        text,
        imagePrompt: parsed.imagePrompt || "Editorial photo of Switzerland, natural light, no text",
        category: parsed.category
      },
      item
    };
  }

  async revise(post: Post, comment: string) {
    const completion = await this.client.chat.completions.create({
      model: config.OPENAI_TEXT_MODEL,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: buildRevisionPrompt(post, comment) }]
    });
    return revisionSchema.parse(JSON.parse(completion.choices[0]?.message.content ?? "{}"));
  }

  async generateImage(prompt: string): Promise<Buffer> {
    const started = Date.now();
    const result = await this.client.images.generate({
      model: config.OPENAI_IMAGE_MODEL,
      prompt,
      size: "1024x1024",
      quality: "low"
    });
    const image = result.data?.[0];
    if (image?.b64_json) {
      logger.info({ ms: Date.now() - started }, "Image generated");
      return Buffer.from(image.b64_json, "base64");
    }
    if (image?.url) {
      const response = await fetch(image.url);
      if (!response.ok) throw new Error(`Image download failed: ${response.status}`);
      logger.info({ ms: Date.now() - started }, "Image generated");
      return Buffer.from(await response.arrayBuffer());
    }
    throw new Error("OpenAI returned no image data");
  }
}
