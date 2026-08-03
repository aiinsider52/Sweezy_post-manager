import type { Post, PostStatus } from "../types.js";

export interface NewPost {
  id: string;
  sourceUrl: string;
  sourceTitle: string;
  text: string;
  imagePath: string | null;
  imageUrl: string | null;
  imagePrompt: string | null;
}

export interface Store {
  init(): Promise<void>;
  close(): Promise<void>;
  hasSeen(urlHash: string): Promise<boolean>;
  markSeen(urlHash: string): Promise<void>;
  createPost(post: NewPost): Promise<Post>;
  getPost(id: string): Promise<Post | null>;
  setReviewMessage(id: string, messageId: number): Promise<void>;
  updatePost(id: string, values: { text: string; imagePath?: string | null; imageUrl?: string | null; imagePrompt?: string | null }): Promise<Post>;
  transition(id: string, from: PostStatus[], to: PostStatus): Promise<boolean>;
  markPublished(id: string): Promise<void>;
  setAwaitingRevision(postId: string | null): Promise<void>;
  getAwaitingRevision(): Promise<string | null>;
}
