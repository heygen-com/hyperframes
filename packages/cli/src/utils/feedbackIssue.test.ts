import { describe, expect, it } from "vitest";

import { buildIssueUrl, HYPERFRAMES_REPO_URL } from "./feedbackIssue.js";

function decoded(url: string, key: "title" | "body"): string {
  const value = new URL(url).searchParams.get(key);
  return value ?? "";
}

describe("buildIssueUrl", () => {
  const base = {
    repoUrl: HYPERFRAMES_REPO_URL,
    rating: 2,
    comment: "GSAP timeline froze on seek",
    repoPublicUrl: "https://hyperframes.dev/p/abc123",
    environment: "os=darwin/arm64 node=v22.11.0 ffmpeg=yes",
    cliVersion: "1.2.3",
  };

  it("points at the repo /issues/new with the bug label", () => {
    const url = buildIssueUrl(base);
    expect(url.startsWith(`${HYPERFRAMES_REPO_URL}/issues/new?`)).toBe(true);
    expect(new URL(url).searchParams.get("labels")).toBe("bug");
  });

  it("encodes the title and includes rating + repro URL in the body", () => {
    const url = buildIssueUrl(base);
    expect(decoded(url, "title")).toBe("[feedback] GSAP timeline froze on seek");
    const body = decoded(url, "body");
    expect(body).toContain("2/10");
    expect(body).toContain("https://hyperframes.dev/p/abc123");
    expect(body).toContain("os=darwin/arm64");
    expect(body).toContain("cli=1.2.3");
  });

  it("falls back to a generic title when there is no comment", () => {
    const url = buildIssueUrl({ ...base, comment: undefined });
    expect(decoded(url, "title")).toBe("Render feedback (rating 2/10)");
  });

  it("truncates an overlong comment in the body", () => {
    const longComment = "x".repeat(9000);
    const url = buildIssueUrl({ ...base, comment: longComment });
    const body = decoded(url, "body");
    expect(body).not.toContain("x".repeat(9000));
    expect(body).toContain("…");
    // Whole URL stays well under the ~8 KB pre-fill limit.
    expect(url.length).toBeLessThan(8000);
  });

  it("strips a trailing .git from the repo url", () => {
    const url = buildIssueUrl({
      ...base,
      repoUrl: "https://github.com/heygen-com/hyperframes.git",
    });
    expect(url.startsWith(`${HYPERFRAMES_REPO_URL}/issues/new?`)).toBe(true);
  });

  it("notes when no repro link is available", () => {
    const url = buildIssueUrl({ ...base, repoPublicUrl: undefined });
    expect(decoded(url, "body")).toContain("Publishing the repro failed");
  });
});
