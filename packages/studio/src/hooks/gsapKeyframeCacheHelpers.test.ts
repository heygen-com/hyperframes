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
  usePlayerStore.setState({ keyframeCache: new Map(), elements: [] });
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
});
