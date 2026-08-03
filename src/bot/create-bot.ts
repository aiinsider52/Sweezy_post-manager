import { Bot } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { config } from "../config.js";
import { logger } from "../logger.js";
import type { Store } from "../db/store.js";
import { AiService } from "../ai/client.js";
import { saveImage } from "../ai/image-store.js";
import { publishPost, sendDraft } from "./send-post.js";

export function createBot(store: Store, ai: AiService): Bot {
  const bot = new Bot(config.BOT_TOKEN);
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 30 }));

  bot.command("start", async (ctx) => {
    const own = ctx.chat.id === config.ADMIN_CHAT_ID;
    await ctx.reply(own ? "Sweezy bot працює. Чернетки надходитимуть сюди." : `Ваш Telegram ID: ${ctx.chat.id}`);
  });

  bot.on("callback_query:data", async (ctx) => {
    if (ctx.from.id !== config.ADMIN_CHAT_ID) { await ctx.answerCallbackQuery({ text: "Недостатньо прав", show_alert: true }); return; }
    const [action, id] = ctx.callbackQuery.data.split(":", 2);
    if (!id || !["publish", "revise", "reject"].includes(action ?? "")) { await ctx.answerCallbackQuery("Невідома дія"); return; }
    const post = await store.getPost(id);
    if (!post) { await ctx.answerCallbackQuery({ text: "Чернетку не знайдено", show_alert: true }); return; }

    if (action === "reject") {
      const changed = await store.transition(id, ["pending_review", "draft"], "rejected");
      await store.setAwaitingRevision(null);
      await ctx.answerCallbackQuery(changed ? "Відхилено" : "Вже оброблено");
      if (changed) await ctx.editMessageReplyMarkup();
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
      await store.setAwaitingRevision(null);
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
      let imagePath = post.imagePath;
      if (revision.regenerateImage) imagePath = await saveImage(config.SQLITE_PATH, post.id, await ai.generateImage(revision.imagePrompt));
      const updated = await store.updatePost(id, { text: revision.text, imagePath, imageUrl: revision.regenerateImage ? null : post.imageUrl, imagePrompt: revision.imagePrompt });
      await store.setAwaitingRevision(null);
      const messageId = await sendDraft(bot.api, config.ADMIN_CHAT_ID, updated);
      if (post.reviewMessageId) {
        await bot.api.editMessageReplyMarkup(config.ADMIN_CHAT_ID, post.reviewMessageId).catch((error) => logger.warn({ err: error, postId: id }, "Old draft keyboard cleanup failed"));
      }
      await store.setReviewMessage(id, messageId);
    } catch (error) {
      logger.error({ err: error, postId: id }, "Revision failed");
      await ctx.reply("❌ Не вдалося переробити. Ваш коментар збережено як активний режим; надішліть його ще раз або /cancel.");
    }
  });

  bot.catch((error) => logger.error({ err: error.error, updateId: error.ctx.update.update_id }, "Bot update failed"));
  return bot;
}
