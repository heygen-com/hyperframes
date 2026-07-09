// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { shouldPreloadMotionPathPlugin } from "./motionPathPluginPreload";

function iframeWithScripts(scripts: string[], timelines?: Record<string, unknown>) {
  const doc = document.implementation.createHTMLDocument();
  for (const text of scripts) {
    const script = doc.createElement("script");
    script.textContent = text;
    doc.body.appendChild(script);
  }
  const iframe = document.createElement("iframe");
  Object.defineProperty(iframe, "contentDocument", { value: doc });
  Object.defineProperty(iframe, "contentWindow", {
    value: {
      __timelines: timelines,
    },
  });
  return iframe;
}

describe("shouldPreloadMotionPathPlugin", () => {
  it("skips the GSAP-only plugin for anime-only compositions", () => {
    const iframe = iframeWithScripts([
      'const tl = anime.createTimeline({ autoplay: false }); tl.add("#box", { opacity: 1 });',
    ]);

    expect(shouldPreloadMotionPathPlugin(iframe)).toBe(false);
  });

  it("preloads for GSAP compositions", () => {
    const iframe = iframeWithScripts([
      'window.__timelines = {}; const tl = gsap.timeline(); tl.to("#box", { x: 10 });',
    ]);

    expect(shouldPreloadMotionPathPlugin(iframe)).toBe(true);
  });

  it("preloads for mixed runtime compositions", () => {
    const iframe = iframeWithScripts([
      'const g = gsap.timeline(); g.to("#box", { x: 10 });',
      'const a = anime.createTimeline({ autoplay: false }); a.add("#box", { opacity: 1 });',
    ]);

    expect(shouldPreloadMotionPathPlugin(iframe)).toBe(true);
  });

  it("preloads when a GSAP timeline is already registered even without inline script text", () => {
    const iframe = iframeWithScripts([], { root: {} });

    expect(shouldPreloadMotionPathPlugin(iframe)).toBe(true);
  });
});
