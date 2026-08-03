import cron, { type ScheduledTask } from "node-cron";
import { config } from "../config.js";
import { logger } from "../logger.js";

export function startScheduler(job: () => Promise<void>): ScheduledTask {
  if (!cron.validate(config.POST_CRON)) throw new Error(`Invalid POST_CRON: ${config.POST_CRON}`);
  const task = cron.schedule(config.POST_CRON, () => void job(), { timezone: config.TIMEZONE });
  logger.info({ cron: config.POST_CRON, timezone: config.TIMEZONE }, "Scheduler started");
  return task;
}
