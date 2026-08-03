import { randomUUID } from "node:crypto";
import type { Bot } from "grammy";
import { config } from "../config.js";
import type { Store } from "../db/store.js";
import { hashUrl } from "../news/hash.js";
import { fetchNews } from "../news/fetch-news.js";
import { AiService } from "../ai/client.js";
import { downloadImage, saveImage } from "../ai/image-store.js";
import { sendDraft } from "../bot/send-post.js";
import { logger } from "../logger.js";

export function createDraftJob(store: Store, ai: AiService, bot: Bot): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) { logger.warn("Draft job skipped: previous run still active"); return; }
    running = true;
    try {
      const all = await fetchNews(config.NEWS_API_KEY);
      const unseen = [];
      for (const item of all) {
        if (!(await store.hasSeen(hashUrl(item.url)))) unseen.push(item);
        if (unseen.length >= 25) break;
      }
      if (!unseen.length) { logger.info("No unseen news found"); return; }
      const { generated, item } = await ai.selectAndWrite(unseen);
      if (!generated.accepted || !item) { logger.info({ reason: generated.reason }, "LLM rejected news batch"); return; }

      const id = randomUUID();
      let imagePath: string;
      if (config.ALLOW_SOURCE_IMAGES && item.imageUrl) {
        try { imagePath = await downloadImage(item.imageUrl, config.SQLITE_PATH, id); }
        catch (error) { logger.warn({ err: error }, "Source image unusable; generating image"); imagePath = await saveImage(config.SQLITE_PATH, id, await ai.generateImage(generated.imagePrompt)); }
      } else {
        imagePath = await saveImage(config.SQLITE_PATH, id, await ai.generateImage(generated.imagePrompt));
      }
      const post = await store.createPost({ id, sourceUrl: item.url, sourceTitle: item.title, text: generated.text, imagePath, imageUrl: null, imagePrompt: generated.imagePrompt });
      let messageId: number;
      try {
        messageId = await sendDraft(bot.api, config.ADMIN_CHAT_ID, post);
      } catch (error) {
        await store.transition(id, ["pending_review"], "rejected");
        throw error;
      }
      await store.setReviewMessage(id, messageId);
      await store.markSeen(hashUrl(item.url));
      logger.info({ postId: id, source: item.source }, "Draft sent for review");
    } catch (error) {
      logger.error({ err: error }, "Draft job failed");
      await bot.api.sendMessage(config.ADMIN_CHAT_ID, `⚠️ Не вдалося створити чернетку: ${error instanceof Error ? error.message : "невідома помилка"}`).catch(() => undefined);
    } finally { running = false; }
  };
}
