import { InlineKeyboard } from "grammy";

export const REJECT_REASONS = {
  weak: "weak",
  topic: "topic",
  image: "image",
  other: "other"
} as const;

export type RejectReason = keyof typeof REJECT_REASONS;

export function reviewKeyboard(postId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Опублікувати", `publish:${postId}`).row()
    .text("✏️ Переробити", `revise:${postId}`).row()
    .text("👎 Слабо", `reject:${postId}:weak`)
    .text("🎯 Тема", `reject:${postId}:topic`).row()
    .text("🖼 Фото", `reject:${postId}:image`)
    .text("❌ Інше", `reject:${postId}:other`);
}
