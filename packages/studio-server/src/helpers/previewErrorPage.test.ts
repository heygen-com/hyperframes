import { describe, expect, it } from "vitest";
import { previewErrorPage, retryAfterSeconds } from "./previewErrorPage";

describe("a refused preview page", () => {
  it("carries the server's Retry-After so a reload can ask again after it", () => {
    const page = previewErrorPage(503, "/runtime.js", 5);
    expect(page).toContain("window.__hfPreviewRetryAfter=5;");
    expect(page).toContain("The preview page could not be loaded (HTTP 503).");
  });

  it("carries none when the server gave none", () => {
    expect(previewErrorPage(404, "/runtime.js")).not.toContain("__hfPreviewRetryAfter");
  });
});

describe("retryAfterSeconds", () => {
  it("reads whole seconds and nothing else", () => {
    expect(retryAfterSeconds("5")).toBe(5);
    expect(retryAfterSeconds(" 1 ")).toBe(1);
    expect(retryAfterSeconds("Wed, 21 Oct 2026 07:28:00 GMT")).toBeUndefined();
    expect(retryAfterSeconds("-1")).toBeUndefined();
    expect(retryAfterSeconds(null)).toBeUndefined();
  });
});
