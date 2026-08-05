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

export type AnalyticsEventType =
  | "draft_created"
  | "published"
  | "rejected"
  | "openai_usage"
  | "llm_skip"
  | "no_news";

export interface AnalyticsEvent {
  eventType: AnalyticsEventType;
  postId?: string | null;
  source?: string | null;
  reason?: string | null;
  model?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  estimatedCostUsd?: number | null;
  meta?: string | null;
}

export interface StatsSummary {
  days: number;
  drafts: number;
  published: number;
  rejected: number;
  llmSkips: number;
  rejectReasons: Record<string, number>;
  topSources: Array<{ source: string; count: number }>;
  openaiCostUsd: number;
  openaiTokens: number;
  openaiImages: number;
}

export interface Store {
  init(): Promise<void>;
  close(): Promise<void>;
  hasSeen(urlHash: string): Promise<boolean>;
  markSeen(urlHash: string): Promise<void>;
  /** True if URL is already in an active/published post (not rejected). */
  hasActiveSourceUrl(url: string): Promise<boolean>;
  createPost(post: NewPost): Promise<Post>;
  getPost(id: string): Promise<Post | null>;
  setReviewMessage(id: string, messageId: number): Promise<void>;
  updatePost(id: string, values: { text: string; imagePath?: string | null; imageUrl?: string | null; imagePrompt?: string | null }): Promise<Post>;
  transition(id: string, from: PostStatus[], to: PostStatus): Promise<boolean>;
  markPublished(id: string): Promise<void>;
  setAwaitingRevision(postId: string | null): Promise<void>;
  getAwaitingRevision(): Promise<string | null>;
  /** Recent post titles for topic diversity (newest first). */
  listRecentSourceTitles(limit?: number): Promise<string[]>;
  logEvent(event: AnalyticsEvent): Promise<void>;
  getStats(days?: number): Promise<StatsSummary>;
}
