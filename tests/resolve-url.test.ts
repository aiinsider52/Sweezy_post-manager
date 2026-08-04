import { describe, expect, it } from "vitest";
import { articleIdFromGoogleUrl } from "../src/news/resolve-url.js";

describe("articleIdFromGoogleUrl", () => {
  it("extracts id from Google News article URLs", () => {
    expect(
      articleIdFromGoogleUrl(
        "https://news.google.com/rss/articles/CBMiabc123_def?oc=5"
      )
    ).toBe("CBMiabc123_def");
    expect(articleIdFromGoogleUrl("https://www.nzz.ch/schweiz/story")).toBeNull();
  });
});
