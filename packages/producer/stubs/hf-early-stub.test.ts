// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import gsap from "gsap";
// Side-effect import: installs the `window.gsap` defineProperty trap that
// wraps `gsap.timeline()` in a batching TimelineProxy. See hf-early-stub.ts.
import "./hf-early-stub.js";

interface HfWindow {
  gsap: { timeline: () => TimelineProxyLike } | null;
}

interface TimelineProxyLike {
  __hfReal: { labels: Record<string, number> };
  labels: Record<string, number>;
  addLabel(name: string, position: number | string): TimelineProxyLike;
}

// The `window.gsap` setter trap installs once at import time. Assigning the
// real `gsap` module here (module scope, not per-test) triggers it exactly
// once — reassigning per-test would re-wrap an already-wrapped
// `gsap.timeline`, double-batching every subsequent proxy.
(window as unknown as HfWindow).gsap = gsap as unknown as HfWindow["gsap"];

describe("hf-early-stub TimelineProxy", () => {
  it("forwards tl.labels live from the wrapped real timeline after addLabel", () => {
    const tl = (window as unknown as HfWindow).gsap!.timeline();

    tl.addLabel("mid", 2);

    // Not a snapshot copy: the same object GSAP mutates in place, so this
    // stays correct however many more labels are added afterward.
    expect(tl.labels).toBe(tl.__hfReal.labels);
    expect(tl.labels["mid"]).toBe(2);

    tl.addLabel("later", 5);
    expect(tl.labels["later"]).toBe(5);
  });

  it("exposes an empty labels object on a timeline with no labels", () => {
    const tl = (window as unknown as HfWindow).gsap!.timeline();

    expect(tl.labels).toEqual({});
  });
});
