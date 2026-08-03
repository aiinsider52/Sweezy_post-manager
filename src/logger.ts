import pino from "pino";
import { config } from "./config.js";

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: ["BOT_TOKEN", "OPENAI_API_KEY", "NEWS_API_KEY", "token", "apiKey"]
});
