import { randomUUID } from "node:crypto";
import type { Bot } from "grammy";
import { config } from "../config.js";
import type { Store } from "../db/store.js";
import { hashUrl } from "../news/hash.js";
import { fetchNews } from "../news/fetch-news.js";
import { fetchArticleBody } from "../news/article.js";
import { diversifyCandidates } from "../news/rank.js";
import { resolveArticleUrl } from "../news/resolve-url.js";
import { AiService } from "../ai/client.js";
import type { UsageRecord } from "../ai/usage.js";
import { downloadImage, saveImage } from "../ai/image-store.js";
import { sendDraft } from "../bot/send-post.js";
import { logger } from "../logger.js";

async function logUsages(store: Store, usages: UsageRecord[], postId?: string, source?: string): Promise<void> {
  for (const usage of usages) {
    await store.logEvent({
      eventType: "openai_usage",
      postId: postId ?? null,
      source: source ?? null,
      model: usage.model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      estimatedCostUsd: usage.estimatedCostUsd,
      meta: JSON.stringify({ kind: usage.kind })
    });
  }
}

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
        if (await store.hasSeen(hashUrl(item.url))) continue;
        if (await store.hasActiveSourceUrl(item.url)) continue;
        unseen.push(item);
        if (unseen.length >= 60) break;
      }
      if (!unseen.length) {
        logger.info("No unseen news found");
        await store.logEvent({ eventType: "no_news", reason: "no_unseen_candidates" });
        await bot.api.sendMessage(config.ADMIN_CHAT_ID, "ℹ️ Немає нових кандидатів для чернетки.").catch(() => undefined);
        return;
      }

      const candidates = diversifyCandidates(unseen, recentTitles, 28);
      logger.info({
        candidates: candidates.length,
        recentTitles,
        top: candidates.slice(0, 8).map((i) => ({ source: i.source, title: i.title, publishedAt: i.publishedAt }))
      }, "Draft candidates");

      const selected = await ai.selectStory(candidates, recentTitles);
      await logUsages(store, [selected.usage], undefined, selected.item?.source);
      if (!selected.accepted || !selected.item) {
        logger.info({ reason: selected.reason }, "LLM rejected news batch");
        await store.logEvent({ eventType: "llm_skip", reason: selected.reason || "rejected", source: selected.item?.source ?? null });
        await bot.api.sendMessage(
          config.ADMIN_CHAT_ID,
          `ℹ️ LLM не обрав матеріал: ${selected.reason || "немає сильного кандидата"}`
        ).catch(() => undefined);
        return;
      }

      const item = selected.item;
      const sourceUrl = await resolveArticleUrl(item.url);
      if (await store.hasActiveSourceUrl(sourceUrl) || await store.hasSeen(hashUrl(sourceUrl))) {
        logger.info({ sourceUrl }, "Resolved URL already active/seen — skipping");
        await store.logEvent({ eventType: "llm_skip", reason: "resolved_url_busy", source: item.source, meta: sourceUrl });
        await bot.api.sendMessage(config.ADMIN_CHAT_ID, "ℹ️ Обрана новина вже в черзі або опублікована. Спробуйте /draft ще раз.").catch(() => undefined);
        return;
      }

      const article = await fetchArticleBody(sourceUrl);
      logger.info({ sourceUrl, articleChars: article?.chars ?? 0 }, "Article body fetched");

      const written = await ai.writePost(item, sourceUrl, article?.text ?? null, selected.category);
      await logUsages(store, [written.usage], undefined, item.source);
      const { generated } = written;
      if (!generated.accepted) {
        await store.logEvent({ eventType: "llm_skip", reason: generated.reason, source: item.source });
        await bot.api.sendMessage(config.ADMIN_CHAT_ID, `ℹ️ Не вдалося написати пост: ${generated.reason}`).catch(() => undefined);
        return;
      }

      const id = randomUUID();
      let imagePath: string;
      if (config.ALLOW_SOURCE_IMAGES && item.imageUrl) {
        try {
          imagePath = await downloadImage(item.imageUrl, config.SQLITE_PATH, id);
        } catch (error) {
          logger.warn({ err: error }, "Source image unusable; generating image");
          const image = await ai.generateImage(generated.imagePrompt);
          await logUsages(store, [image.usage], id, item.source);
          imagePath = await saveImage(config.SQLITE_PATH, id, image.buffer);
        }
      } else {
        const image = await ai.generateImage(generated.imagePrompt);
        await logUsages(store, [image.usage], id, item.source);
        imagePath = await saveImage(config.SQLITE_PATH, id, image.buffer);
      }

      const post = await store.createPost({
        id,
        sourceUrl,
        sourceTitle: item.title,
        text: generated.text,
        imagePath,
        imageUrl: null,
        imagePrompt: generated.imagePrompt
      });
      let messageId: number;
      try {
        messageId = await sendDraft(bot.api, config.ADMIN_CHAT_ID, post);
      } catch (error) {
        await store.transition(id, ["pending_review"], "rejected");
        throw error;
      }
      await store.setReviewMessage(id, messageId);
      // Do NOT markSeen here — only on publish. Rejected drafts can be retried later.
      await store.logEvent({
        eventType: "draft_created",
        postId: id,
        source: item.source,
        reason: article ? `article_chars=${article.chars}` : "no_article_body",
        meta: JSON.stringify({ category: generated.category, sourceUrl })
      });
      logger.info({ postId: id, source: item.source, sourceUrl, articleChars: article?.chars ?? 0, ms: Date.now() - started }, "Draft sent for review");
    } catch (error) {
      const message = error instanceof Error ? error.message : "невідома помилка";
      const shuttingDown = /database connection is not open/i.test(message);
      logger.error({ err: error, ms: Date.now() - started, shuttingDown }, "Draft job failed");
      const text = shuttingDown
        ? "⚠️ Зараз іде оновлення сервісу. Зачекайте ~1 хвилину і знову надішліть /draft."
        : `⚠️ Не вдалося створити чернетку: ${message}`;
      await bot.api.sendMessage(config.ADMIN_CHAT_ID, text).catch(() => undefined);
    } finally { running = false; }
  };
}
