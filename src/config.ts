import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  BOT_TOKEN: z.string().min(20),
  ADMIN_CHAT_ID: z.coerce.number().int(),
  CHANNEL_ID: z.string().min(2),
  OPENAI_API_KEY: z.string().min(20),
  NEWS_API_KEY: z.string().optional(),
  POST_CRON: z.string().default("0 9,15 * * *"),
  TIMEZONE: z.string().default("Europe/Zurich"),
  DATABASE_URL: z.string().url().optional().or(z.literal("")),
  SQLITE_PATH: z.string().default("./data/sweezy.db"),
  OPENAI_TEXT_MODEL: z.string().default("gpt-4.1-mini"),
  OPENAI_IMAGE_MODEL: z.string().default("gpt-image-1"),
  PORT: z.coerce.number().int().positive().default(10000),
  LOG_LEVEL: z.string().default("info"),
  ALLOW_SOURCE_IMAGES: z.enum(["true", "false"]).default("false").transform((v) => v === "true")
});

const result = schema.safeParse(process.env);
if (!result.success) {
  throw new Error(`Invalid environment: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`);
}

export const config = result.data;
