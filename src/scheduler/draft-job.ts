import { randomUUID } from "node:crypto";
import type { Bot } from "grammy";
import { config } from "../config.js";
import type { Store } from "../db/store.js";
import { hashUrl } from "../news/hash.js";
import { fetchNews } from "../news/fetch-news.js";
import { diversifyCandidates } from "../news/rank.js";
import { resolveArticleUrl } from "../news/resolve-url.js";
import { AiService } from "../ai/client.js";
import { downloadImage, saveImage } from "../ai/image-store.js";
import { sendDraft } from "../bot/send-post.js";
import { logger } from "../logger.js";

export function createDraftJob(store: Store, ai: AiService, bot: Bot): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) { logger.warn("Draft job skipped: previous run still active"); return; }
    running = true;
    const started = Date.now();
    try {
      const recentTitles = await store.listRecentSourceTitles(8);
      const all = await fetchNews(config.NEWS_API_KEY);
      const unseen = [];
      for (const item of all) {
        if (!(await store.hasSeen(hashUrl(item.url)))) unseen.push(item);
        if (unseen.length >= 60) break;
      }
      if (!unseen.length) { logger.info("No unseen news found"); return; }
      const candidates = diversifyCandidates(unseen, recentTitles, 28);
      logger.info({
        candidates: candidates.length,
        recentTitles,
        top: candidates.slice(0, 8).map((i) => ({ source: i.source, title: i.title, publishedAt: i.publishedAt }))
      }, "Draft candidates");
      const { generated, item } = await ai.selectAndWrite(candidates, recentTitles);
      if (!generated.accepted || !item) { logger.info({ reason: generated.reason }, "LLM rejected news batch"); return; }

      const sourceUrl = await resolveArticleUrl(item.url);
      const id = randomUUID();
      let imagePath: string;
      if (config.ALLOW_SOURCE_IMAGES && item.imageUrl) {
        try { imagePath = await downloadImage(item.imageUrl, config.SQLITE_PATH, id); }
        catch (error) { logger.warn({ err: error }, "Source image unusable; generating image"); imagePath = await saveImage(config.SQLITE_PATH, id, await ai.generateImage(generated.imagePrompt)); }
      } else {
        imagePath = await saveImage(config.SQLITE_PATH, id, await ai.generateImage(generated.imagePrompt));
      }
      // Rebuild caption with resolved publisher URL when Google News was selected.
      let text = generated.text;
      if (sourceUrl !== item.url && text.includes(item.url)) {
        text = text.replaceAll(item.url, sourceUrl);
      } else if (sourceUrl !== item.url) {
        text = text.replace(/href="[^"]*news\.google\.com[^"]*"/g, `href="${sourceUrl.replaceAll('"', "&quot;")}"`);
      }
      const post = await store.createPost({ id, sourceUrl, sourceTitle: item.title, text, imagePath, imageUrl: null, imagePrompt: generated.imagePrompt });
      let messageId: number;
      try {
        messageId = await sendDraft(bot.api, config.ADMIN_CHAT_ID, post);
      } catch (error) {
        await store.transition(id, ["pending_review"], "rejected");
        throw error;
      }
      await store.setReviewMessage(id, messageId);
      await store.markSeen(hashUrl(sourceUrl));
      if (sourceUrl !== item.url) await store.markSeen(hashUrl(item.url));
      logger.info({ postId: id, source: item.source, sourceUrl, ms: Date.now() - started }, "Draft sent for review");
    } catch (error) {
      const message = error instanceof Error ? error.message : "невідома помилка";
      const shuttingDown = /database connection is not open/i.test(message);
      logger.error({ err: error, ms: Date.now() - started, shuttingDown }, "Draft job failed");
      const text = shuttingDown
        ? "⚠️ Зараз іде оновлення сервісу. Зачекайте ~1 хвилину і знову надішліть /draft."
        : `⚠️ Не вдалося створити чернетку: ${message}`;
      await bot.api.sendMessage(config.ADMIN_CHAT_ID, text).catch(() => undefined);
      // Don't rethrow — caller (/draft) already got a user-facing message here.
    } finally { running = false; }
  };
}
