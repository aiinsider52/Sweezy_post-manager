import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Post, PostStatus } from "../types.js";
import { rowToPost } from "./mapping.js";
import type { AnalyticsEvent, NewPost, StatsSummary, Store } from "./store.js";

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
      CREATE INDEX IF NOT EXISTS posts_source_url_idx ON posts(source_url);
      CREATE TABLE IF NOT EXISTS editorial_state (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        awaiting_revision_post_id TEXT REFERENCES posts(id) ON DELETE SET NULL
      );
      INSERT OR IGNORE INTO editorial_state(singleton, awaiting_revision_post_id) VALUES(1, NULL);
      CREATE TABLE IF NOT EXISTS analytics_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        post_id TEXT,
        source TEXT,
        reason TEXT,
        model TEXT,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        estimated_cost_usd REAL,
        meta TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS analytics_events_created_idx ON analytics_events(created_at);
      CREATE INDEX IF NOT EXISTS analytics_events_type_idx ON analytics_events(event_type);
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

  async hasActiveSourceUrl(url: string): Promise<boolean> {
    this.assertOpen();
    return Boolean(
      this.db.prepare(
        "SELECT 1 FROM posts WHERE source_url = ? AND status IN ('pending_review','approved','published') LIMIT 1"
      ).get(url)
    );
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

  async listRecentSourceTitles(limit = 8): Promise<string[]> {
    this.assertOpen();
    const rows = this.db.prepare(
      "SELECT source_title AS title FROM posts ORDER BY datetime(created_at) DESC, rowid DESC LIMIT ?"
    ).all(limit) as Array<{ title: string }>;
    return rows.map((row) => row.title).filter(Boolean);
  }

  async logEvent(event: AnalyticsEvent): Promise<void> {
    this.assertOpen();
    this.db.prepare(`INSERT INTO analytics_events(
      event_type, post_id, source, reason, model, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, meta
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      event.eventType,
      event.postId ?? null,
      event.source ?? null,
      event.reason ?? null,
      event.model ?? null,
      event.promptTokens ?? null,
      event.completionTokens ?? null,
      event.totalTokens ?? null,
      event.estimatedCostUsd ?? null,
      event.meta ?? null
    );
  }

  async getStats(days = 7): Promise<StatsSummary> {
    this.assertOpen();
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const countType = (type: string) =>
      Number((this.db.prepare("SELECT COUNT(*) AS c FROM analytics_events WHERE event_type = ? AND created_at >= ?").get(type, since) as { c: number }).c);

    const rejectRows = this.db.prepare(
      "SELECT COALESCE(reason, 'other') AS reason, COUNT(*) AS c FROM analytics_events WHERE event_type = 'rejected' AND created_at >= ? GROUP BY reason"
    ).all(since) as Array<{ reason: string; c: number }>;
    const rejectReasons: Record<string, number> = {};
    for (const row of rejectRows) rejectReasons[row.reason] = row.c;

    const sourceRows = this.db.prepare(
      "SELECT COALESCE(source, 'unknown') AS source, COUNT(*) AS c FROM analytics_events WHERE event_type IN ('draft_created','published') AND created_at >= ? GROUP BY source ORDER BY c DESC LIMIT 8"
    ).all(since) as Array<{ source: string; c: number }>;

    const usage = this.db.prepare(
      `SELECT
         COALESCE(SUM(estimated_cost_usd), 0) AS cost,
         COALESCE(SUM(total_tokens), 0) AS tokens,
         COALESCE(SUM(CASE WHEN model LIKE '%image%' OR (prompt_tokens IS NULL OR prompt_tokens = 0) AND estimated_cost_usd > 0 AND total_tokens = 0 THEN 1 ELSE 0 END), 0) AS images
       FROM analytics_events WHERE event_type = 'openai_usage' AND created_at >= ?`
    ).get(since) as { cost: number; tokens: number; images: number };

    // Count image usages more reliably via meta
    const imageCount = Number((this.db.prepare(
      "SELECT COUNT(*) AS c FROM analytics_events WHERE event_type = 'openai_usage' AND created_at >= ? AND (meta LIKE '%\"kind\":\"image\"%' OR model LIKE '%image%')"
    ).get(since) as { c: number }).c);

    return {
      days,
      drafts: countType("draft_created"),
      published: countType("published"),
      rejected: countType("rejected"),
      llmSkips: countType("llm_skip") + countType("no_news"),
      rejectReasons,
      topSources: sourceRows.map((row) => ({ source: row.source, count: row.c })),
      openaiCostUsd: Number(usage.cost) || 0,
      openaiTokens: Number(usage.tokens) || 0,
      openaiImages: imageCount || Number(usage.images) || 0
    };
  }
}
