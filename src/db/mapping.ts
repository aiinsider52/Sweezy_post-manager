import type { Post } from "../types.js";

export function rowToPost(row: Record<string, unknown>): Post {
  return {
    id: String(row.id),
    sourceUrl: String(row.source_url),
    status: row.status as Post["status"],
    text: String(row.text),
    imagePath: row.image_path == null ? null : String(row.image_path),
    imageUrl: row.image_url == null ? null : String(row.image_url),
    imagePrompt: row.image_prompt == null ? null : String(row.image_prompt),
    sourceTitle: String(row.source_title),
    reviewMessageId: row.review_message_id == null ? null : Number(row.review_message_id),
    revisionCount: Number(row.revision_count),
    createdAt: String(row.created_at),
    publishedAt: row.published_at == null ? null : String(row.published_at)
  };
}
