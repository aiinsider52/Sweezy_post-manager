import { config } from "./config.js";
import { logger } from "./logger.js";
import { createStore } from "./db/index.js";
import { AiService } from "./ai/client.js";
import { createBot } from "./bot/create-bot.js";
import { createDraftJob } from "./scheduler/draft-job.js";
import { startScheduler } from "./scheduler/index.js";
import { startHealthServer } from "./health.js";

const store = createStore();
await store.init();
const ai = new AiService();
const bot = createBot(store, ai);
const healthServer = startHealthServer();

async function verifyChannelPermissions(): Promise<void> {
  try {
    const me = await bot.api.getMe();
    const member = await bot.api.getChatMember(config.CHANNEL_ID, me.id);
    const canPost = member.status === "creator" || (member.status === "administrator" && member.can_post_messages !== false);
    if (!canPost) throw new Error(`Bot status is ${member.status}; can_post_messages is unavailable`);
    logger.info({ channelId: config.CHANNEL_ID }, "Channel posting permission verified");
  } catch (error) {
    logger.error({ err: error, channelId: config.CHANNEL_ID }, "Bot cannot post to channel");
    await bot.api.sendMessage(config.ADMIN_CHAT_ID, `🚨 Бот не може публікувати в канал ${config.CHANNEL_ID}. Додайте його адміністратором із правом «Публікувати повідомлення».`).catch(() => undefined);
  }
}

await bot.init();
await verifyChannelPermissions();
const draftJob = createDraftJob(store, ai, bot);
const scheduledTask = startScheduler(draftJob);

const stop = async (signal: string) => {
  logger.info({ signal }, "Shutting down");
  scheduledTask.stop();
  bot.stop();
  healthServer.close();
  await store.close();
};
process.once("SIGTERM", () => void stop("SIGTERM"));
process.once("SIGINT", () => void stop("SIGINT"));

logger.info({ username: bot.botInfo.username }, "Bot starting long polling");
await bot.start({ allowed_updates: ["message", "callback_query"] });
