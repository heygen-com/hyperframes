// @vitest-environment happy-dom

import { describe, it, expect, vi } from "vitest";
import { applySoftReload } from "./gsapSoftReload";

const SCRIPT_TEXT = `
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
tl.to("#box", { opacity: 0.8 });
window.__timelines["root"] = tl;
`;

function buildMockIframe(overrides: Record<string, unknown> = {}) {
  const scriptEl = document.createElement("script");
  scriptEl.textContent =
    'const tl = gsap.timeline({ paused: true }); tl.to("#box", { opacity: 0.5 });';
  const container = document.createElement("div");
  container.appendChild(scriptEl);

  const mockTimeline = { kill: vi.fn(), pause: vi.fn() };
  const contentWindow = {
    gsap: { timeline: vi.fn() },
    __hfForceTimelineRebind: vi.fn(),
    __timelines: { root: mockTimeline } as Record<string, typeof mockTimeline>,
    __player: { getTime: () => 2.0, seek: vi.fn() },
    __hfStudioManualEditsApply: vi.fn(),
    __hfSuppressSceneMutations: undefined as undefined | (<T>(fn: () => T) => T),
    ...overrides,
  };

  // Intercept appendChild: when a <script> is appended, simulate execution by
  // repopulating __timelines (mimicking what the real GSAP script would do).
  const realAppendChild = container.appendChild.bind(container);
  container.appendChild = <T extends Node>(node: T): T => {
    const result = realAppendChild(node);
    if (node instanceof HTMLScriptElement && node.textContent?.includes("gsap.timeline")) {
      // Simulate the script populating __timelines
      const cw = contentWindow as { __timelines?: Record<string, unknown> };
      if (cw.__timelines) {
        cw.__timelines.root = { kill: vi.fn(), pause: vi.fn() };
      }
    }
    return result;
  };

  const contentDocument = {
    querySelectorAll: (sel: string) => (sel === "script:not([src])" ? [scriptEl] : []),
    createElement: (tag: string) => document.createElement(tag),
    body: container,
    head: document.createElement("div"),
  };

  return {
    iframe: { contentWindow, contentDocument } as unknown as HTMLIFrameElement,
    contentWindow,
    mockTimeline,
  };
}

describe("applySoftReload", () => {
  it("returns false when iframe is null", () => {
    expect(applySoftReload(null, SCRIPT_TEXT)).toBe(false);
  });

  it("returns false when scriptText is empty", () => {
    const { iframe } = buildMockIframe();
    expect(applySoftReload(iframe, "")).toBe(false);
  });

  it("returns false when gsap is not on iframe window", () => {
    const { iframe } = buildMockIframe({ gsap: undefined });
    expect(applySoftReload(iframe, SCRIPT_TEXT)).toBe(false);
  });

  it("returns false when __hfForceTimelineRebind is missing", () => {
    const { iframe } = buildMockIframe({ __hfForceTimelineRebind: undefined });
    expect(applySoftReload(iframe, SCRIPT_TEXT)).toBe(false);
  });

  it("kills existing timelines, rebinds, and re-seeks on success", () => {
    const { iframe, contentWindow, mockTimeline } = buildMockIframe();
    const result = applySoftReload(iframe, SCRIPT_TEXT);
    expect(result).toBe(true);
    expect(mockTimeline.kill).toHaveBeenCalled();
    expect(contentWindow.__hfForceTimelineRebind).toHaveBeenCalled();
    expect(contentWindow.__player.seek).toHaveBeenCalledWith(2.0);
    expect(contentWindow.__hfStudioManualEditsApply).toHaveBeenCalled();
  });

  it("wraps execution in __hfSuppressSceneMutations when available", () => {
    let suppressionCalled = false;
    const { iframe } = buildMockIframe({
      __hfSuppressSceneMutations: <T>(fn: () => T): T => {
        suppressionCalled = true;
        return fn();
      },
    });
    const result = applySoftReload(iframe, SCRIPT_TEXT);
    expect(result).toBe(true);
    expect(suppressionCalled).toBe(true);
  });

  it("returns false when multiple GSAP scripts exist (ambiguous)", () => {
    const script1 = document.createElement("script");
    script1.textContent = "const tl = gsap.timeline({ paused: true });";
    const script2 = document.createElement("script");
    script2.textContent = 'tl.to("#other", { x: 10 });';
    const container = document.createElement("div");
    container.appendChild(script1);
    container.appendChild(script2);

    const { iframe } = buildMockIframe();
    (iframe as unknown as { contentDocument: unknown }).contentDocument = {
      querySelectorAll: (sel: string) => (sel === "script:not([src])" ? [script1, script2] : []),
      createElement: (tag: string) => document.createElement(tag),
      body: container,
    };
    expect(applySoftReload(iframe, SCRIPT_TEXT)).toBe(false);
  });
});
