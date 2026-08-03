export type PostStatus = "draft" | "pending_review" | "approved" | "published" | "rejected";

export interface NewsItem {
  title: string;
  url: string;
  description: string;
  publishedAt?: string;
  imageUrl?: string;
  source: string;
}

export interface Post {
  id: string;
  sourceUrl: string;
  status: PostStatus;
  text: string;
  imagePath: string | null;
  imageUrl: string | null;
  imagePrompt: string | null;
  sourceTitle: string;
  reviewMessageId: number | null;
  revisionCount: number;
  createdAt: string;
  publishedAt: string | null;
}

export interface GeneratedPost {
  accepted: boolean;
  reason: string;
  text: string;
  imagePrompt: string;
  category: "product" | "useful_news" | "light" | "skip";
}
