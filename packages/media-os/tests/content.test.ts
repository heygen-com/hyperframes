import { describe, expect, it } from "vitest";
import { getTodayPostCount, summarizePosts } from "../src/lib/content";

describe("content helpers", () => {
  it("counts posts from today", () => {
    const now = new Date();
    const posts = [
      { date: now.toISOString() },
      { date: new Date(now.getTime() - 86400000).toISOString() },
    ];

    expect(getTodayPostCount(posts as any)).toBe(1);
  });

  it("summarizes posts with clean display values", () => {
    const posts = [
      {
        title: { rendered: "Hello Media OS" },
        excerpt: { rendered: "<p>Short summary</p>" },
        link: "https://example.com/post/1",
      },
    ];

    const result = summarizePosts(posts as any);

    expect(result[0].title).toBe("Hello Media OS");
    expect(result[0].excerpt).toContain("Short summary");
    expect(result[0].link).toBe("https://example.com/post/1");
  });
});
