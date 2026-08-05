import pg from "pg";
import type { Post, PostStatus } from "../types.js";
import { rowToPost } from "./mapping.js";
import type { AnalyticsEvent, NewPost, StatsSummary, Store } from "./store.js";

export class PostgresStore implements Store {
  private pool: pg.Pool;
  constructor(url: string) { this.pool = new pg.Pool({ connectionString: url, ssl: url.includes("localhost") ? false : { rejectUnauthorized: false } }); }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY, source_url TEXT NOT NULL, status TEXT NOT NULL,
        text TEXT NOT NULL, image_path TEXT, image_url TEXT, image_prompt TEXT,
        source_title TEXT NOT NULL, review_message_id BIGINT, revision_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), published_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS seen_news (url_hash TEXT PRIMARY KEY, seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE INDEX IF NOT EXISTS posts_status_idx ON posts(status);
      CREATE INDEX IF NOT EXISTS posts_source_url_idx ON posts(source_url);
      CREATE TABLE IF NOT EXISTS editorial_state (singleton INTEGER PRIMARY KEY CHECK(singleton=1), awaiting_revision_post_id TEXT REFERENCES posts(id) ON DELETE SET NULL);
      INSERT INTO editorial_state(singleton, awaiting_revision_post_id) VALUES(1,NULL) ON CONFLICT DO NOTHING;
      CREATE TABLE IF NOT EXISTS analytics_events (
        id BIGSERIAL PRIMARY KEY,
        event_type TEXT NOT NULL,
        post_id TEXT,
        source TEXT,
        reason TEXT,
        model TEXT,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        estimated_cost_usd DOUBLE PRECISION,
        meta TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS analytics_events_created_idx ON analytics_events(created_at);
      CREATE INDEX IF NOT EXISTS analytics_events_type_idx ON analytics_events(event_type);
    `);
  }
  async close(): Promise<void> { await this.pool.end(); }
  async hasSeen(hash: string): Promise<boolean> { return (await this.pool.query("SELECT 1 FROM seen_news WHERE url_hash=$1", [hash])).rowCount === 1; }
  async markSeen(hash: string): Promise<void> { await this.pool.query("INSERT INTO seen_news(url_hash) VALUES($1) ON CONFLICT DO NOTHING", [hash]); }
  async hasActiveSourceUrl(url: string): Promise<boolean> {
    return (await this.pool.query(
      "SELECT 1 FROM posts WHERE source_url=$1 AND status = ANY($2) LIMIT 1",
      [url, ["pending_review", "approved", "published"]]
    )).rowCount === 1;
  }
  async createPost(p: NewPost): Promise<Post> {
    const { rows } = await this.pool.query(`INSERT INTO posts(id,source_url,status,text,image_path,image_url,image_prompt,source_title)
      VALUES($1,$2,'pending_review',$3,$4,$5,$6,$7) RETURNING *`, [p.id,p.sourceUrl,p.text,p.imagePath,p.imageUrl,p.imagePrompt,p.sourceTitle]);
    return rowToPost(rows[0]);
  }
  async getPost(id: string): Promise<Post | null> { const { rows } = await this.pool.query("SELECT * FROM posts WHERE id=$1", [id]); return rows[0] ? rowToPost(rows[0]) : null; }
  async setReviewMessage(id: string, messageId: number): Promise<void> { await this.pool.query("UPDATE posts SET review_message_id=$1 WHERE id=$2", [messageId,id]); }
  async updatePost(id: string, v: { text: string; imagePath?: string | null; imageUrl?: string | null; imagePrompt?: string | null }): Promise<Post> {
    const current = await this.getPost(id); if (!current) throw new Error(`Post ${id} not found`);
    const { rows } = await this.pool.query(`UPDATE posts SET text=$1,image_path=$2,image_url=$3,image_prompt=$4,
      revision_count=revision_count+1,status='pending_review' WHERE id=$5 RETURNING *`, [v.text,v.imagePath ?? current.imagePath,v.imageUrl ?? current.imageUrl,v.imagePrompt ?? current.imagePrompt,id]);
    return rowToPost(rows[0]);
  }
  async transition(id: string, from: PostStatus[], to: PostStatus): Promise<boolean> { return (await this.pool.query("UPDATE posts SET status=$1 WHERE id=$2 AND status=ANY($3)",[to,id,from])).rowCount === 1; }
  async markPublished(id: string): Promise<void> { await this.pool.query("UPDATE posts SET status='published',published_at=NOW() WHERE id=$1 AND status='approved'",[id]); }
  async setAwaitingRevision(postId: string | null): Promise<void> { await this.pool.query("UPDATE editorial_state SET awaiting_revision_post_id=$1 WHERE singleton=1",[postId]); }
  async getAwaitingRevision(): Promise<string | null> { const { rows } = await this.pool.query("SELECT awaiting_revision_post_id AS id FROM editorial_state WHERE singleton=1"); return rows[0]?.id ?? null; }
  async listRecentSourceTitles(limit = 8): Promise<string[]> {
    const { rows } = await this.pool.query("SELECT source_title AS title FROM posts ORDER BY created_at DESC LIMIT $1", [limit]);
    return rows.map((row: { title: string }) => row.title).filter(Boolean);
  }
  async logEvent(event: AnalyticsEvent): Promise<void> {
    await this.pool.query(`INSERT INTO analytics_events(
      event_type, post_id, source, reason, model, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, meta
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
      event.eventType, event.postId ?? null, event.source ?? null, event.reason ?? null, event.model ?? null,
      event.promptTokens ?? null, event.completionTokens ?? null, event.totalTokens ?? null,
      event.estimatedCostUsd ?? null, event.meta ?? null
    ]);
  }
  async getStats(days = 7): Promise<StatsSummary> {
    const { rows: typeRows } = await this.pool.query(
      `SELECT event_type, COUNT(*)::int AS c FROM analytics_events
       WHERE created_at >= NOW() - ($1 || ' days')::interval GROUP BY event_type`,
      [String(days)]
    );
    const counts = Object.fromEntries(typeRows.map((row: { event_type: string; c: number }) => [row.event_type, row.c]));
    const { rows: rejectRows } = await this.pool.query(
      `SELECT COALESCE(reason,'other') AS reason, COUNT(*)::int AS c FROM analytics_events
       WHERE event_type='rejected' AND created_at >= NOW() - ($1 || ' days')::interval GROUP BY reason`,
      [String(days)]
    );
    const rejectReasons: Record<string, number> = {};
    for (const row of rejectRows as Array<{ reason: string; c: number }>) rejectReasons[row.reason] = row.c;
    const { rows: sourceRows } = await this.pool.query(
      `SELECT COALESCE(source,'unknown') AS source, COUNT(*)::int AS c FROM analytics_events
       WHERE event_type = ANY($2) AND created_at >= NOW() - ($1 || ' days')::interval
       GROUP BY source ORDER BY c DESC LIMIT 8`,
      [String(days), ["draft_created", "published"]]
    );
    const { rows: usageRows } = await this.pool.query(
      `SELECT COALESCE(SUM(estimated_cost_usd),0)::float AS cost,
              COALESCE(SUM(total_tokens),0)::int AS tokens,
              COUNT(*) FILTER (WHERE meta LIKE '%"kind":"image"%' OR model LIKE '%image%')::int AS images
       FROM analytics_events WHERE event_type='openai_usage' AND created_at >= NOW() - ($1 || ' days')::interval`,
      [String(days)]
    );
    const usage = usageRows[0] ?? { cost: 0, tokens: 0, images: 0 };
    return {
      days,
      drafts: counts.draft_created ?? 0,
      published: counts.published ?? 0,
      rejected: counts.rejected ?? 0,
      llmSkips: (counts.llm_skip ?? 0) + (counts.no_news ?? 0),
      rejectReasons,
      topSources: (sourceRows as Array<{ source: string; c: number }>).map((row) => ({ source: row.source, count: row.c })),
      openaiCostUsd: Number(usage.cost) || 0,
      openaiTokens: Number(usage.tokens) || 0,
      openaiImages: Number(usage.images) || 0
    };
  }
}
