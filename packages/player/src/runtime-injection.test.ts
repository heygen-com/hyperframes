import { describe, expect, it } from "vitest";
import {
  injectRuntimeIntoHtml,
  needsPreParseRuntime,
  type PreParseRuntimeState,
} from "./runtime-injection.js";

const baseState: PreParseRuntimeState = {
  hasRuntime: false,
  hasTimelines: false,
  hasAnimeRegistrations: false,
  referencesHyperframesAnime: false,
  alreadyAttempted: false,
};

describe("needsPreParseRuntime", () => {
  it("injects when the document references hyperframesAnime and nothing else has resolved it", () => {
    expect(needsPreParseRuntime({ ...baseState, referencesHyperframesAnime: true })).toBe(true);
  });

  it("does not inject when hyperframesAnime is never referenced", () => {
    expect(needsPreParseRuntime(baseState)).toBe(false);
  });

  it("does not inject once the runtime bridge is present", () => {
    expect(
      needsPreParseRuntime({ ...baseState, referencesHyperframesAnime: true, hasRuntime: true }),
    ).toBe(false);
  });

  it("does not inject when GSAP __timelines is already populated", () => {
    expect(
      needsPreParseRuntime({ ...baseState, referencesHyperframesAnime: true, hasTimelines: true }),
    ).toBe(false);
  });

  it("does not inject once an anime registry already has entries", () => {
    expect(
      needsPreParseRuntime({
        ...baseState,
        referencesHyperframesAnime: true,
        hasAnimeRegistrations: true,
      }),
    ).toBe(false);
  });

  it("loop guard: never injects twice for the same src", () => {
    expect(
      needsPreParseRuntime({
        ...baseState,
        referencesHyperframesAnime: true,
        alreadyAttempted: true,
      }),
    ).toBe(false);
  });
});

describe("injectRuntimeIntoHtml", () => {
  const runtimeUrl = "https://cdn.example.com/hyperframe.runtime.iife.js";
  const baseHref = "https://cdn.example.com/compositions/h05/";

  it("inserts base + script at the start of an existing head", () => {
    const html = "<html><head><title>x</title></head><body></body></html>";
    const out = injectRuntimeIntoHtml(html, runtimeUrl, baseHref);
    expect(out).toBe(
      `<html><head><base href="${baseHref}"><script src="${runtimeUrl}"></script><title>x</title></head><body></body></html>`,
    );
  });

  it("preserves an existing base tag instead of adding a second one", () => {
    const html = '<html><head><base href="/already/"><title>x</title></head></html>';
    const out = injectRuntimeIntoHtml(html, runtimeUrl, baseHref);
    expect(out).toBe(
      `<html><head><script src="${runtimeUrl}"></script><base href="/already/"><title>x</title></head></html>`,
    );
    // Only one <base> tag survives.
    expect(out.match(/<base\b/gi)).toHaveLength(1);
  });

  it("creates a head when html has none", () => {
    const html = "<html><body>no head here</body></html>";
    const out = injectRuntimeIntoHtml(html, runtimeUrl, baseHref);
    expect(out).toBe(
      `<html><head><base href="${baseHref}"><script src="${runtimeUrl}"></script></head><body>no head here</body></html>`,
    );
  });

  it("handles malformed HTML (no html, no head) without throwing", () => {
    const html = "just some fragment <div>content</div>";
    expect(() => injectRuntimeIntoHtml(html, runtimeUrl, baseHref)).not.toThrow();
    const out = injectRuntimeIntoHtml(html, runtimeUrl, baseHref);
    expect(out).toBe(
      `<head><base href="${baseHref}"><script src="${runtimeUrl}"></script></head>just some fragment <div>content</div>`,
    );
  });

  it("escapes quotes in the runtime URL and base href", () => {
    const out = injectRuntimeIntoHtml(
      "<html><head></head></html>",
      'https://evil.example/x"><script>1</script>',
      'https://example.com/"quoted"/',
    );
    expect(out).not.toContain('"><script>1</script>');
    expect(out).toContain("&quot;");
  });
});
