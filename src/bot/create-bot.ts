import { Bot } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { config } from "../config.js";
import { logger } from "../logger.js";
import type { Store } from "../db/store.js";
import { hashUrl } from "../news/hash.js";
import { AiService } from "../ai/client.js";
import { saveImage } from "../ai/image-store.js";
import { publishPost, sendDraft } from "./send-post.js";
import { REJECT_REASONS, type RejectReason } from "./keyboards.js";

function formatStats(stats: Awaited<ReturnType<Store["getStats"]>>): string {
  const reasons = Object.entries(stats.rejectReasons)
    .map(([reason, count]) => `${reason}: ${count}`)
    .join(", ") || "—";
  const sources = stats.topSources
    .map((entry) => `• ${entry.source}: ${entry.count}`)
    .join("\n") || "• —";
  return [
    `📊 <b>Статистика за ${stats.days} дн.</b>`,
    "",
    `Чернетки: <b>${stats.drafts}</b>`,
    `Опубліковано: <b>${stats.published}</b>`,
    `Відхилено: <b>${stats.rejected}</b> (${reasons})`,
    `Пропуски LLM/новин: <b>${stats.llmSkips}</b>`,
    "",
    `<b>Топ джерел</b>`,
    sources,
    "",
    `<b>OpenAI</b> (орієнтовно)`,
    `Вартість: <b>$${stats.openaiCostUsd.toFixed(3)}</b>`,
    `Токени: <b>${stats.openaiTokens}</b>`,
    `Картинки: <b>${stats.openaiImages}</b>`
  ].join("\n");
}

export function createBot(store: Store, ai: AiService, runDraftJob?: () => Promise<void>): Bot {
  const bot = new Bot(config.BOT_TOKEN);
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 30 }));

  bot.command("start", async (ctx) => {
    const own = ctx.chat.id === config.ADMIN_CHAT_ID;
    await ctx.reply(own
      ? "Sweezy bot працює. Команди: /draft · /stats · /cancel"
      : `Ваш Telegram ID: ${ctx.chat.id}`);
  });

  bot.command("stats", async (ctx) => {
    if (ctx.from?.id !== config.ADMIN_CHAT_ID) return;
    const stats = await store.getStats(7);
    await ctx.reply(formatStats(stats), { parse_mode: "HTML" });
  });

  bot.command("draft", async (ctx) => {
    if (ctx.from?.id !== config.ADMIN_CHAT_ID) return;
    if (!runDraftJob) {
      await ctx.reply("Job ще не готовий. Спробуйте за хвилину.");
      return;
    }
    await ctx.reply("⏳ Створюю чернетку (новини → стаття → текст → картинка, ~30–120 сек)…");
    try {
      await runDraftJob();
    } catch (error) {
      logger.error({ err: error }, "Manual /draft failed");
      await ctx.reply(`❌ Не вдалося створити чернетку: ${error instanceof Error ? error.message : "невідома помилка"}`);
    }
  });

  bot.on("callback_query:data", async (ctx) => {
    if (ctx.from.id !== config.ADMIN_CHAT_ID) { await ctx.answerCallbackQuery({ text: "Недостатньо прав", show_alert: true }); return; }
    const parts = ctx.callbackQuery.data.split(":");
    const action = parts[0];
    const id = parts[1];
    const rejectReason = (parts[2] as RejectReason | undefined) ?? "other";
    if (!id || !["publish", "revise", "reject"].includes(action ?? "")) { await ctx.answerCallbackQuery("Невідома дія"); return; }
    const post = await store.getPost(id);
    if (!post) { await ctx.answerCallbackQuery({ text: "Чернетку не знайдено", show_alert: true }); return; }

    if (action === "reject") {
      const reason = rejectReason in REJECT_REASONS ? rejectReason : "other";
      const changed = await store.transition(id, ["pending_review", "draft"], "rejected");
      await store.setAwaitingRevision(null);
      if (changed) {
        await store.logEvent({
          eventType: "rejected",
          postId: id,
          source: post.sourceTitle,
          reason,
          meta: JSON.stringify({ sourceUrl: post.sourceUrl })
        });
        await ctx.editMessageReplyMarkup();
      }
      await ctx.answerCallbackQuery(changed ? `Відхилено (${reason})` : "Вже оброблено");
      return;
    }
    if (action === "revise") {
      if (post.status !== "pending_review") { await ctx.answerCallbackQuery({ text: "Чернетку вже оброблено", show_alert: true }); return; }
      await store.setAwaitingRevision(id);
      await ctx.answerCallbackQuery("Надішліть коментар наступним повідомленням");
      await ctx.reply("✏️ Напишіть, що змінити. Наприклад: «зроби коротше» або «заміни картинку». Для скасування: /cancel");
      return;
    }

    const claimed = await store.transition(id, ["pending_review"], "approved");
    if (!claimed) { await ctx.answerCallbackQuery({ text: "Чернетку вже оброблено", show_alert: true }); return; }
    try {
      const channelMessageId = await publishPost(bot.api, config.CHANNEL_ID, post);
      await store.markPublished(id);
      await store.markSeen(hashUrl(post.sourceUrl));
      await store.setAwaitingRevision(null);
      await store.logEvent({
        eventType: "published",
        postId: id,
        source: post.sourceTitle,
        meta: JSON.stringify({ channelMessageId, sourceUrl: post.sourceUrl })
      });
      await ctx.answerCallbackQuery("Опубліковано");
      await ctx.editMessageReplyMarkup();
      await ctx.reply(`✅ Опубліковано. Message ID: ${channelMessageId}`);
    } catch (error) {
      await store.transition(id, ["approved"], "pending_review");
      logger.error({ err: error, postId: id }, "Publishing failed");
      await ctx.answerCallbackQuery({ text: "Помилка публікації. Спробуйте ще раз.", show_alert: true });
    }
  });

  bot.command("cancel", async (ctx) => {
    if (ctx.from?.id !== config.ADMIN_CHAT_ID) return;
    await store.setAwaitingRevision(null);
    await ctx.reply("Редагування скасовано.");
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.from.id !== config.ADMIN_CHAT_ID || ctx.message.text.startsWith("/")) return;
    const id = await store.getAwaitingRevision();
    if (!id) return;
    const post = await store.getPost(id);
    if (!post || post.status !== "pending_review") { await store.setAwaitingRevision(null); return; }
    await ctx.reply("⏳ Переробляю чернетку…");
    try {
      const revision = await ai.revise(post, ctx.message.text);
      await store.logEvent({
        eventType: "openai_usage",
        postId: id,
        model: revision.usage.model,
        promptTokens: revision.usage.promptTokens,
        completionTokens: revision.usage.completionTokens,
        totalTokens: revision.usage.totalTokens,
        estimatedCostUsd: revision.usage.estimatedCostUsd,
        meta: JSON.stringify({ kind: revision.usage.kind, action: "revise" })
      });
      let imagePath = post.imagePath;
      if (revision.regenerateImage) {
        const image = await ai.generateImage(revision.imagePrompt);
        await store.logEvent({
          eventType: "openai_usage",
          postId: id,
          model: image.usage.model,
          promptTokens: image.usage.promptTokens,
          completionTokens: image.usage.completionTokens,
          totalTokens: image.usage.totalTokens,
          estimatedCostUsd: image.usage.estimatedCostUsd,
          meta: JSON.stringify({ kind: image.usage.kind, action: "revise_image" })
        });
        imagePath = await saveImage(config.SQLITE_PATH, post.id, image.buffer);
      }
      const updated = await store.updatePost(id, { text: revision.text, imagePath, imageUrl: revision.regenerateImage ? null : post.imageUrl, imagePrompt: revision.imagePrompt });
      await store.setAwaitingRevision(null);
      const messageId = await sendDraft(bot.api, config.ADMIN_CHAT_ID, updated);
      if (post.reviewMessageId) {
        await bot.api.editMessageReplyMarkup(config.ADMIN_CHAT_ID, post.reviewMessageId).catch((error) => logger.warn({ err: error, postId: id }, "Old draft keyboard cleanup failed"));
      }
      await store.setReviewMessage(id, messageId);
    } catch (error) {
      logger.error({ err: error, postId: id }, "Revision failed");
      const detail = error instanceof Error ? error.message.slice(0, 180) : "невідома помилка";
      await ctx.reply(`❌ Не вдалося переробити: ${detail}\nСпробуйте ще раз або /cancel.`);
    }
  });

  bot.catch((error) => logger.error({ err: error.error, updateId: error.ctx.update.update_id }, "Bot update failed"));
  return bot;
}
