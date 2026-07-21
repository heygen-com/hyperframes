import { describe, it, expect, beforeEach } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { usePlayerStore, type KeyframeCacheEntry } from "../player/store/playerStore";
import {
  clearKeyframeCacheForElement,
  clearKeyframeCacheForFile,
  updateKeyframeCacheFromParsed,
} from "./gsapKeyframeCacheHelpers";

const entry = (): KeyframeCacheEntry => ({
  format: "percentage",
  keyframes: [{ percentage: 0, properties: { x: 0 } }],
});

const seed = (key: string) => usePlayerStore.getState().setKeyframeCache(key, entry());
const cache = () => usePlayerStore.getState().keyframeCache;

const animWithKeyframes = (id: string): GsapAnimation => ({
  id,
  targetSelector: `#${id}`,
  method: "to",
  position: 0,
  properties: {},
  duration: 1,
  resolvedStart: 0,
  propertyGroup: "position",
  keyframes: { format: "percentage", keyframes: [{ percentage: 50, properties: { x: 100 } }] },
});

beforeEach(() => {
  usePlayerStore.setState({ keyframeCache: new Map(), gsapAnimations: new Map(), elements: [] });
});

describe("clearKeyframeCacheForElement", () => {
  it("drops the prefixed, index.html fallback, and bare key for a non-index source", () => {
    seed("comp.html#box");
    seed("index.html#box");
    seed("box");

    clearKeyframeCacheForElement("comp.html", "box");

    expect(cache().has("comp.html#box")).toBe(false);
    expect(cache().has("index.html#box")).toBe(false);
    // The bare key is what PropertyPanel's keyframe nav reads (element.id), so
    // it must be cleared too, not just the prefixed variants.
    expect(cache().has("box")).toBe(false);
  });

  it("drops the prefixed and bare key for an index.html source", () => {
    seed("index.html#hero");
    seed("hero");

    clearKeyframeCacheForElement("index.html", "hero");

    expect(cache().has("index.html#hero")).toBe(false);
    expect(cache().has("hero")).toBe(false);
  });

  it("leaves other elements' keys untouched", () => {
    seed("index.html#box");
    seed("box");
    seed("index.html#other");
    seed("other");

    clearKeyframeCacheForElement("index.html", "box");

    expect(cache().has("index.html#other")).toBe(true);
    expect(cache().has("other")).toBe(true);
  });
});

describe("clearKeyframeCacheForFile", () => {
  it("clears the prefixed, fallback, and bare keys for every element of the file", () => {
    seed("comp.html#a");
    seed("index.html#a");
    seed("a");
    seed("comp.html#b");
    seed("b");

    clearKeyframeCacheForFile("comp.html");

    for (const key of ["comp.html#a", "index.html#a", "a", "comp.html#b", "b"]) {
      expect(cache().has(key)).toBe(false);
    }
  });

  it("leaves entries that belong to a different source file", () => {
    seed("comp.html#a");
    seed("a");
    seed("other.html#z");
    seed("z");

    clearKeyframeCacheForFile("comp.html");

    expect(cache().has("other.html#z")).toBe(true);
    expect(cache().has("z")).toBe(true);
  });
});

describe("updateKeyframeCacheFromParsed", () => {
  it("records colliding animation targets with their own tween percentages", () => {
    const animation = (
      id: string,
      propertyGroup: string,
      properties: Record<string, number>,
      percentage: number,
      resolvedStart: number,
    ): GsapAnimation => ({
      ...animWithKeyframes(id),
      targetSelector: "#hero",
      propertyGroup,
      resolvedStart,
      keyframes: { format: "percentage", keyframes: [{ percentage, properties }] },
    });

    usePlayerStore.setState({
      elements: [{ id: "hero", domId: "hero", tag: "div", start: 0, duration: 4, track: 0 }],
    });

    updateKeyframeCacheFromParsed(
      [
        animation("hero-position", "position", { x: 100 }, 50, 0.5),
        animation("hero-visual", "visual", { opacity: 1 }, 80, 0.2),
        animation("hero-position", "position", { y: 50 }, 25, 0.75),
        animation("hero-scale", "scale", { scale: 2 }, 60, 0.4),
      ],
      "scene.html",
      "hero",
      {},
    );

    expect(cache().get("scene.html#hero")?.keyframes[0]?.collidingAnimationTargets).toEqual([
      { animationId: "hero-position", tweenPercentage: 50 },
      { animationId: "hero-visual", tweenPercentage: 80 },
      { animationId: "hero-scale", tweenPercentage: 60 },
    ]);
  });

  it("serializes a multi-keyframe tween with a stable shape and animation identity", () => {
    const animation: GsapAnimation = {
      ...animWithKeyframes("hero"),
      duration: 2,
      resolvedStart: 3,
      keyframes: {
        format: "percentage",
        keyframes: [
          { percentage: 0, properties: { x: 0 } },
          { percentage: 50, properties: { x: 100 }, ease: "power1.inOut" },
          { percentage: 100, properties: { x: 200 } },
        ],
        easeEach: "power1.inOut",
      },
    };
    usePlayerStore.setState({
      elements: [
        {
          id: "hero-clip",
          domId: "hero",
          tag: "div",
          start: 2,
          duration: 4,
          track: 0,
        },
      ],
    });

    updateKeyframeCacheFromParsed([animation], "scene.html", "hero", {});

    expect(JSON.stringify(cache().get("scene.html#hero"))).toBe(
      '{"format":"percentage","keyframes":[{"percentage":25,"properties":{"x":0},"tweenPercentage":0,"propertyGroup":"position","animationId":"hero"},{"percentage":50,"properties":{"x":100},"ease":"power1.inOut","tweenPercentage":50,"propertyGroup":"position","animationId":"hero"},{"percentage":75,"properties":{"x":200},"tweenPercentage":100,"propertyGroup":"position","animationId":"hero"}],"easeEach":"power1.inOut"}',
    );
  });

  it("clears the bare key when the selected element no longer has keyframes", () => {
    // Element previously had keyframes, so a bare entry exists (writes set both).
    seed("index.html#box");
    seed("box");

    // A mutation leaves #box without any keyframes in the parsed animations.
    updateKeyframeCacheFromParsed([], "index.html", "box", {});

    expect(cache().has("index.html#box")).toBe(false);
    // Without the bare-key clear this assertion fails: the stale entry survives
    // and PropertyPanel keeps rendering the removed keyframes.
    expect(cache().has("box")).toBe(false);
  });

  it("still writes the bare key for elements that have keyframes", () => {
    updateKeyframeCacheFromParsed([animWithKeyframes("hero")], "index.html", "hero", {});

    expect(cache().has("index.html#hero")).toBe(true);
    expect(cache().has("hero")).toBe(true);
  });

  it("caches flat tweens as clip-relative start and end keyframes", () => {
    const animation: GsapAnimation = {
      id: "flat-box",
      targetSelector: "#box",
      method: "to",
      position: 1,
      properties: { x: 420 },
      duration: 2,
      resolvedStart: 1,
      ease: "power2.out",
      propertyGroup: "position",
    };
    usePlayerStore.setState({
      elements: [{ id: "box-clip", domId: "box", tag: "div", start: 1, duration: 2, track: 0 }],
    });

    updateKeyframeCacheFromParsed([animation], "scene.html", "box", {});

    expect(cache().get("scene.html#box")).toEqual({
      format: "percentage",
      keyframes: [
        {
          percentage: 0,
          properties: { x: 0 },
          tweenPercentage: 0,
          propertyGroup: "position",
          animationId: "flat-box",
        },
        {
          percentage: 100,
          properties: { x: 420 },
          ease: "power2.out",
          tweenPercentage: 100,
          propertyGroup: "position",
          animationId: "flat-box",
        },
      ],
    });
    expect(usePlayerStore.getState().gsapAnimations.get("scene.html#box")).toEqual([animation]);
  });

  it("does not cache a flat tween without animatable numeric properties", () => {
    const animation: GsapAnimation = {
      id: "flat-box",
      targetSelector: "#box",
      method: "to",
      position: 0,
      properties: { backgroundColor: "#fff" },
      duration: 1,
      propertyGroup: "visual",
    };

    updateKeyframeCacheFromParsed([animation], "scene.html", "box", {});

    expect(cache().has("scene.html#box")).toBe(false);
    expect(cache().has("box")).toBe(false);
    expect(usePlayerStore.getState().gsapAnimations.has("scene.html#box")).toBe(false);
  });
});
