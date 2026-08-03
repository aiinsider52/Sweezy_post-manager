import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteStore } from "../src/db/sqlite-store.js";

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
});
