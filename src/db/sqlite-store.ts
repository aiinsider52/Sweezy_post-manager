import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Post, PostStatus } from "../types.js";
import { rowToPost } from "./mapping.js";
import type { NewPost, Store } from "./store.js";

export class SqliteStore implements Store {
  private db: Database.Database;
  private closed = false;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("The database connection is not open");
  }

  async init(): Promise<void> {
    this.assertOpen();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY,
        source_url TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('draft','pending_review','approved','published','rejected')),
        text TEXT NOT NULL,
        image_path TEXT,
        image_url TEXT,
        image_prompt TEXT,
        source_title TEXT NOT NULL,
        review_message_id INTEGER,
        revision_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        published_at TEXT
      );
      CREATE TABLE IF NOT EXISTS seen_news (
        url_hash TEXT PRIMARY KEY,
        seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS posts_status_idx ON posts(status);
      CREATE TABLE IF NOT EXISTS editorial_state (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        awaiting_revision_post_id TEXT REFERENCES posts(id) ON DELETE SET NULL
      );
      INSERT OR IGNORE INTO editorial_state(singleton, awaiting_revision_post_id) VALUES(1, NULL);
    `);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
  async hasSeen(hash: string): Promise<boolean> {
    this.assertOpen();
    return Boolean(this.db.prepare("SELECT 1 FROM seen_news WHERE url_hash = ?").get(hash));
  }
  async markSeen(hash: string): Promise<void> {
    this.assertOpen();
    this.db.prepare("INSERT OR IGNORE INTO seen_news(url_hash) VALUES (?)").run(hash);
  }

  async createPost(post: NewPost): Promise<Post> {
    this.db.prepare(`INSERT INTO posts(id, source_url, status, text, image_path, image_url, image_prompt, source_title)
      VALUES (@id, @sourceUrl, 'pending_review', @text, @imagePath, @imageUrl, @imagePrompt, @sourceTitle)`).run(post);
    return (await this.getPost(post.id))!;
  }

  async getPost(id: string): Promise<Post | null> {
    const row = this.db.prepare("SELECT * FROM posts WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToPost(row) : null;
  }

  async setReviewMessage(id: string, messageId: number): Promise<void> {
    this.db.prepare("UPDATE posts SET review_message_id = ? WHERE id = ?").run(messageId, id);
  }

  async updatePost(id: string, values: { text: string; imagePath?: string | null; imageUrl?: string | null; imagePrompt?: string | null }): Promise<Post> {
    const current = await this.getPost(id);
    if (!current) throw new Error(`Post ${id} not found`);
    this.db.prepare(`UPDATE posts SET text = ?, image_path = ?, image_url = ?, image_prompt = ?,
      revision_count = revision_count + 1, status = 'pending_review' WHERE id = ?`).run(
      values.text,
      values.imagePath === undefined ? current.imagePath : values.imagePath,
      values.imageUrl === undefined ? current.imageUrl : values.imageUrl,
      values.imagePrompt === undefined ? current.imagePrompt : values.imagePrompt,
      id
    );
    return (await this.getPost(id))!;
  }

  async transition(id: string, from: PostStatus[], to: PostStatus): Promise<boolean> {
    const placeholders = from.map(() => "?").join(",");
    return this.db.prepare(`UPDATE posts SET status = ? WHERE id = ? AND status IN (${placeholders})`).run(to, id, ...from).changes === 1;
  }

  async markPublished(id: string): Promise<void> {
    this.db.prepare("UPDATE posts SET status = 'published', published_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'approved'").run(id);
  }
  async setAwaitingRevision(postId: string | null): Promise<void> { this.db.prepare("UPDATE editorial_state SET awaiting_revision_post_id = ? WHERE singleton = 1").run(postId); }
  async getAwaitingRevision(): Promise<string | null> { const row = this.db.prepare("SELECT awaiting_revision_post_id AS id FROM editorial_state WHERE singleton = 1").get() as { id: string | null }; return row.id; }
}
