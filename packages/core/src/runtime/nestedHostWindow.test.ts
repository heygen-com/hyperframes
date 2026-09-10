import { describe, it, expect } from "vitest";
import {
  mapClipThroughHostWindow,
  mapNestedMediaElement as mapNestedMediaElementWith,
  resolveNestedHostWindow as resolveNestedHostWindowWith,
  sourceTimeAt,
  type AttrNode,
  type HostStartResolver,
} from "./nestedHostWindow";

function el(attrs: Record<string, string>, parent: AttrNode | null = null): AttrNode {
  return {
    parentElement: parent,
    hasAttribute(name: string) {
      return Object.prototype.hasOwnProperty.call(attrs, name);
    },
    getAttribute(name: string) {
      return attrs[name] ?? null;
    },
  };
}

/** Numeric `data-start` only — the id-ref case injects its own resolver below. */
const numericStart: HostStartResolver = (host) =>
  Number.parseFloat(host.getAttribute("data-start") ?? "") || 0;
const resolveNestedHostWindow = (element: AttrNode) =>
  resolveNestedHostWindowWith(element, numericStart);
const mapNestedMediaElement = (element: AttrNode) =>
  mapNestedMediaElementWith(element, numericStart);

describe("nestedHostWindow", () => {
  it("head-trims overlapping media and drops clips before the in-point", () => {
    const host = el({
      "data-composition-file": "scene.html",
      "data-start": "5",
      "data-end": "7",
      "data-playback-start": "1.5",
    });
    const video = el({ "data-start": "1", "data-duration": "4", "data-end": "5" }, host);
    const window = resolveNestedHostWindow(video);
    expect(window).toMatchObject({ offset: 3.5, rate: 1, windowStart: 5, limit: 7, remaps: true });
    expect(mapClipThroughHostWindow(1, 5, window!)).toEqual({
      start: 5,
      end: 7,
      origin: 4.5,
      playbackRate: 1,
    });
    expect(mapClipThroughHostWindow(0, 1, window!)).toEqual({
      start: 5,
      end: 5,
      origin: 3.5,
      playbackRate: 1,
    });
    expect(mapClipThroughHostWindow(2, 3, window!)).toEqual({
      start: 5.5,
      end: 6.5,
      origin: 5.5,
      playbackRate: 1,
    });
    expect(sourceTimeAt({ origin: 4.5, mediaStart: 0 }, 5)).toBe(0.5);
  });

  it("clamps empty and past-limit clips to a zero-width window", () => {
    const host = el({ "data-composition-file": "scene.html", "data-start": "5", "data-end": "7" });
    const window = resolveNestedHostWindow(el({}, host))!;
    expect(mapClipThroughHostWindow(1, 1, window)).toMatchObject({ start: 6, end: 6 });
    expect(mapClipThroughHostWindow(2, 3, window)).toMatchObject({ start: 7, end: 7, origin: 7 });
    expect(mapClipThroughHostWindow(0, Infinity, window)).toEqual({
      start: 5,
      end: 7,
      origin: 5,
      playbackRate: 1,
    });
  });

  it("still head-trims when the slot is at t=0 without bumping mediaStart", () => {
    const host = el({
      "data-composition-file": "scene.html",
      "data-start": "0",
      "data-end": "2",
      "data-playback-start": "1.5",
    });
    const video = el({ "data-start": "1", "data-end": "5", "data-media-start": "0.25" }, host);
    const mapped = mapNestedMediaElement(video);
    expect(mapped).toEqual({ start: 0, end: 2, origin: -0.5, mediaStart: 0.25, playbackRate: 1 });
    expect(sourceTimeAt(mapped!, 0)).toBe(0.75);
  });

  it("bounds the slot by host data-duration when data-end is absent (#3245 repro)", () => {
    const host = el({
      "data-composition-src": "scene.html",
      "data-start": "1",
      "data-duration": "2",
      "data-playback-start": "1.5",
    });
    const video = el({ "data-start": "0", "data-duration": "4" }, host);
    expect(resolveNestedHostWindow(video)).toMatchObject({
      offset: -0.5,
      windowStart: 1,
      limit: 3,
    });
    expect(mapNestedMediaElement(video)).toEqual({
      start: 1,
      end: 3,
      origin: -0.5,
      mediaStart: 0,
      playbackRate: 1,
    });
  });

  it("reads the runtime's preserved data-hf-authored-* host bounds", () => {
    const host = el({
      "data-composition-file": "scene.html",
      "data-start": "1",
      "data-hf-authored-duration": "2",
      "data-playback-start": "1.5",
    });
    expect(resolveNestedHostWindow(el({}, host))).toMatchObject({ limit: 3 });
    const byEnd = el({
      "data-composition-file": "scene.html",
      "data-start": "1",
      "data-hf-authored-end": "4",
      "data-playback-start": "1.5",
    });
    expect(resolveNestedHostWindow(el({}, byEnd))).toMatchObject({ limit: 4 });
  });

  it("leaves media without a numeric data-start to the composition-context resolver", () => {
    const host = el({
      "data-composition-file": "scene.html",
      "data-start": "5",
      "data-end": "9",
      "data-playback-start": "1",
    });
    expect(mapNestedMediaElement(el({ "data-start": "intro + 1" }, host))).toBeNull();
    expect(mapNestedMediaElement(el({}, host))).toBeNull();
  });

  it("reports a clip that ends before the in-point as a zero-width window, not null", () => {
    const host = el({
      "data-composition-file": "scene.html",
      "data-start": "5",
      "data-end": "7",
      "data-playback-start": "3",
    });
    const video = el({ "data-start": "0", "data-end": "2" }, host);
    expect(mapNestedMediaElement(video)).toEqual({
      start: 5,
      end: 5,
      origin: 2,
      mediaStart: 0,
      playbackRate: 1,
    });
  });

  it("leaves identity slots (no in-point, rate 1) to the PIP heuristic", () => {
    const host = el({
      "data-composition-file": "scene.html",
      "data-start": "5",
      "data-end": "7",
    });
    const video = el({ "data-start": "0" }, host);
    expect(mapNestedMediaElement(video)).toBeNull();
  });

  it("maps a host playback-rate onto descendant media", () => {
    const host = el({
      "data-composition-file": "scene.html",
      "data-start": "5",
      "data-end": "7",
      "data-playback-rate": "2",
    });
    const video = el({ "data-start": "0", "data-end": "4" }, host);
    const window = resolveNestedHostWindow(video);
    expect(window).toMatchObject({ offset: 5, rate: 2, windowStart: 5, remaps: true });
    expect(mapClipThroughHostWindow(0, 4, window!)).toEqual({
      start: 5,
      end: 7,
      origin: 5,
      playbackRate: 2,
    });
    const mapped = mapNestedMediaElement(video);
    expect(mapped).toMatchObject({ start: 5, end: 7, origin: 5, playbackRate: 2 });
    expect(sourceTimeAt(mapped!, 6)).toBe(2);
  });

  it("composes in-point and host rate", () => {
    const host = el({
      "data-composition-file": "scene.html",
      "data-start": "5",
      "data-end": "7",
      "data-playback-start": "1.5",
      "data-playback-rate": "2",
    });
    const video = el({ "data-start": "1", "data-end": "5" }, host);
    const mapped = mapNestedMediaElement(video);
    expect(mapped).toMatchObject({
      start: 5,
      end: 6.75,
      origin: 4.75,
      mediaStart: 0,
      playbackRate: 2,
    });
    expect(sourceTimeAt(mapped!, 5)).toBeCloseTo(0.5);
  });

  it("composes child playback-rate onto the host rate", () => {
    const host = el({
      "data-composition-file": "scene.html",
      "data-start": "5",
      "data-end": "7",
      "data-playback-rate": "2",
    });
    const video = el({ "data-start": "0", "data-end": "4", "data-playback-rate": "2" }, host);
    expect(mapNestedMediaElement(video)?.playbackRate).toBe(4);
  });

  it("source time at the audible start is the in-file skip, not a pre-host play", () => {
    // Visible [1, 3], origin −0.5 → mix/extract from 1.5s in the file.
    expect(sourceTimeAt({ origin: -0.5, mediaStart: 0 }, 1)).toBe(1.5);
    expect(sourceTimeAt({ origin: -0.5, mediaStart: 0, playbackRate: 2 }, 1)).toBe(3);
  });

  it("resolves host data-start through the caller's resolver", () => {
    const host = el({
      "data-composition-file": "scene.html",
      "data-start": "intro",
      "data-end": "12",
    });
    const video = el({ "data-start": "0", "data-end": "4" }, host);
    const afterIntro: HostStartResolver = (node) =>
      node.getAttribute("data-start") === "intro" ? 10 : 0;
    expect(resolveNestedHostWindowWith(video, afterIntro)).toMatchObject({
      offset: 10,
      rate: 1,
      windowStart: 10,
      limit: 12,
    });
  });

  it("leaves media authored in root time to the composition-context resolver", () => {
    const host = el({
      "data-composition-file": "scene.html",
      "data-start": "5",
      "data-end": "9",
      "data-playback-start": "1",
    });
    const legacy = el({ "data-start": "6", "data-hf-media-start-basis": "global" }, host);
    expect(mapNestedMediaElement(legacy)).toBeNull();
  });
});
