import { describe, expect, it } from "bun:test";
import { resolveBrowserMediaEnd } from "./shared.js";

describe("resolveBrowserMediaEnd", () => {
  it("prefers a runtime duration over a stale compiler-clamped end", () => {
    expect(resolveBrowserMediaEnd(0, 5.04, 56.738)).toBe(56.738);
  });

  it("projects a runtime duration from the browser-local start", () => {
    expect(resolveBrowserMediaEnd(2, 7.04, 56.738)).toBe(58.738);
  });

  it("falls back to data-end when runtime duration is unavailable", () => {
    expect(resolveBrowserMediaEnd(0, 5.04, Number.NaN)).toBe(5.04);
    expect(resolveBrowserMediaEnd(0, 5.04, 0)).toBe(5.04);
  });
});
