import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteStore } from "../src/db/sqlite-store.js";
import { hashUrl } from "../src/news/hash.js";

describe("approve/revise/reject state flow", () => {
  let store: SqliteStore;
  beforeEach(async () => {
    store = new SqliteStore(":memory:"); await store.init();
    await store.createPost({ id: "p1", sourceUrl: "https://example.com/1", sourceTitle: "Title", text: "Draft", imagePath: null, imageUrl: null, imagePrompt: "image" });
  });
  afterEach(async () => store.close());

  it("approves once and then publishes", async () => {
    expect(await store.transition("p1", ["pending_review"], "approved")).toBe(true);
    expect(await store.transition("p1", ["pending_review"], "approved")).toBe(false);
    await store.markPublished("p1");
    expect((await store.getPost("p1"))?.status).toBe("published");
  });
  it("persists revision intent and returns updated post to review", async () => {
    await store.setAwaitingRevision("p1");
    expect(await store.getAwaitingRevision()).toBe("p1");
    const post = await store.updatePost("p1", { text: "Revised" });
    expect(post.status).toBe("pending_review"); expect(post.revisionCount).toBe(1); expect(post.text).toBe("Revised");
  });
  it("rejects and prevents later approval", async () => {
    expect(await store.transition("p1", ["pending_review"], "rejected")).toBe(true);
    expect(await store.transition("p1", ["pending_review"], "approved")).toBe(false);
  });
  it("lists recent source titles newest first", async () => {
    await store.createPost({ id: "p2", sourceUrl: "https://example.com/2", sourceTitle: "Newer", text: "Draft2", imagePath: null, imageUrl: null, imagePrompt: "image" });
    expect(await store.listRecentSourceTitles(5)).toEqual(["Newer", "Title"]);
  });
  it("tracks active urls and only treats published as permanently seen when marked", async () => {
    expect(await store.hasActiveSourceUrl("https://example.com/1")).toBe(true);
    await store.transition("p1", ["pending_review"], "rejected");
    expect(await store.hasActiveSourceUrl("https://example.com/1")).toBe(false);
    expect(await store.hasSeen(hashUrl("https://example.com/1"))).toBe(false);
  });
  it("stores analytics and returns stats", async () => {
    await store.logEvent({ eventType: "draft_created", postId: "p1", source: "SRF" });
    await store.logEvent({ eventType: "rejected", postId: "p1", reason: "weak", source: "SRF" });
    await store.logEvent({
      eventType: "openai_usage",
      model: "gpt-4.1-mini",
      promptTokens: 1000,
      completionTokens: 200,
      totalTokens: 1200,
      estimatedCostUsd: 0.001,
      meta: JSON.stringify({ kind: "text" })
    });
    await store.logEvent({
      eventType: "openai_usage",
      model: "gpt-image-1",
      estimatedCostUsd: 0.08,
      totalTokens: 0,
      meta: JSON.stringify({ kind: "image" })
    });
    const stats = await store.getStats(7);
    expect(stats.drafts).toBe(1);
    expect(stats.rejected).toBe(1);
    expect(stats.rejectReasons.weak).toBe(1);
    expect(stats.openaiImages).toBe(1);
    expect(stats.openaiCostUsd).toBeGreaterThan(0.07);
  });
});
