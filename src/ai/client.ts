import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";
import type { GeneratedPost, NewsItem, Post } from "../types.js";
import { formatPostHtml } from "../bot/format-post.js";
import { buildRevisionPrompt, buildSelectionPrompt } from "./prompts.js";

const selectionSchema = z.object({
  accepted: z.boolean(),
  reason: z.string(),
  selectedUrl: z.string(),
  title: z.string().default(""),
  body: z.string().default(""),
  takeaway: z.string().default(""),
  imagePrompt: z.string(),
  category: z.enum(["product", "useful_news", "light", "skip"])
});
const revisionSchema = z.object({ text: z.string().min(1).max(1024), imagePrompt: z.string(), regenerateImage: z.boolean() });

export class AiService {
  private client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  async selectAndWrite(items: NewsItem[]): Promise<{ generated: GeneratedPost; item: NewsItem | null }> {
    const completion = await this.client.chat.completions.create({
      model: config.OPENAI_TEXT_MODEL,
      temperature: 0.55,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: buildSelectionPrompt(items) }]
    });
    const parsed = selectionSchema.parse(JSON.parse(completion.choices[0]?.message.content ?? "{}"));
    const item = items.find((candidate) => candidate.url === parsed.selectedUrl) ?? null;
    const accepted = parsed.accepted && Boolean(item);
    const text = accepted && item
      ? formatPostHtml({
          title: parsed.title,
          body: parsed.body,
          takeaway: parsed.takeaway,
          sourceUrl: item.url,
          sourceLabel: `Джерело · ${item.source}`,
          category: parsed.category
        })
      : "";
    if (text.length > 1024) throw new Error(`Generated caption exceeds Telegram limit: ${text.length}`);
    return {
      generated: {
        accepted,
        reason: parsed.reason,
        text,
        imagePrompt: parsed.imagePrompt,
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
    const result = await this.client.images.generate({ model: config.OPENAI_IMAGE_MODEL, prompt, size: "1024x1024", quality: "medium" });
    const image = result.data?.[0];
    if (image?.b64_json) return Buffer.from(image.b64_json, "base64");
    if (image?.url) {
      const response = await fetch(image.url);
      if (!response.ok) throw new Error(`Image download failed: ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    }
    throw new Error("OpenAI returned no image data");
  }
}
