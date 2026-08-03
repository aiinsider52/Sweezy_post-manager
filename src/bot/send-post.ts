import { InputFile, type Api } from "grammy";
import type { Post } from "../types.js";
import { reviewKeyboard } from "./keyboards.js";

function media(post: Post): string | InputFile | null {
  if (post.imagePath) return new InputFile(post.imagePath);
  return post.imageUrl;
}

export async function sendDraft(api: Api, adminChatId: number, post: Post): Promise<number> {
  const image = media(post);
  const caption = `📝 ЧЕРНЕТКА #${post.revisionCount + 1}\n\n${post.text}`;
  if (caption.length > 1024) throw new Error(`Draft caption exceeds Telegram limit: ${caption.length}`);
  if (image) {
    const message = await api.sendPhoto(adminChatId, image, { caption, reply_markup: reviewKeyboard(post.id) });
    return message.message_id;
  }
  const message = await api.sendMessage(adminChatId, caption, { reply_markup: reviewKeyboard(post.id), link_preview_options: { is_disabled: true } });
  return message.message_id;
}

export async function publishPost(api: Api, channelId: string, post: Post): Promise<number> {
  const image = media(post);
  if (image) return (await api.sendPhoto(channelId, image, { caption: post.text })).message_id;
  return (await api.sendMessage(channelId, post.text, { link_preview_options: { is_disabled: true } })).message_id;
}
