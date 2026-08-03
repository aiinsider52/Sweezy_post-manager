import { InlineKeyboard } from "grammy";

export function reviewKeyboard(postId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Опублікувати", `publish:${postId}`).row()
    .text("✏️ Переробити", `revise:${postId}`)
    .text("❌ Відхилити", `reject:${postId}`);
}
