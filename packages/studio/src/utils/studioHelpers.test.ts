// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findMatchingTimelineElementId,
  findTimelineIdByAncestor,
  resolveDroppedAssetDimensions,
  resolveTimelineIdForSelection,
  resolveTimelineSelectionSeekTime,
} from "./studioHelpers";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("resolveTimelineSelectionSeekTime", () => {
  it("keeps the current time when it is already inside the clip range", () => {
    expect(resolveTimelineSelectionSeekTime(3, { start: 0, duration: 5 })).toBe(3);
  });

  it("clamps to the clip start when current time is before the clip", () => {
    expect(resolveTimelineSelectionSeekTime(1, { start: 4, duration: 3 })).toBe(4);
  });

  it("clamps to the clip end when current time is after the clip", () => {
    expect(resolveTimelineSelectionSeekTime(10, { start: 4, duration: 3 })).toBe(7);
  });

  it("falls back to the clip start for invalid current time", () => {
    expect(resolveTimelineSelectionSeekTime(Number.NaN, { start: 2, duration: 5 })).toBe(2);
  });
});

describe("findMatchingTimelineElementId", () => {
  const el = (over: Record<string, unknown>) =>
    ({ id: "x", start: 0, duration: 1, track: 0, tag: "div", ...over }) as never;

  it("matches a top-level element by domId + sourceFile", () => {
    const els = [el({ id: "s1", domId: "s1", sourceFile: "index.html" })];
    expect(findMatchingTimelineElementId({ id: "s1", sourceFile: "index.html" }, els)).toBe("s1");
  });

  it("returns a qualified id for a sub-comp child with no matching timeline element", () => {
    const els = [el({ id: "s3", domId: "s3", sourceFile: "index.html" })];
    expect(
      findMatchingTimelineElementId(
        { id: "stat-3", sourceFile: "compositions/stats-panel.html" },
        els,
      ),
    ).toBe("compositions/stats-panel.html#stat-3");
  });

  it("returns null for an unmatched element in index.html", () => {
    expect(findMatchingTimelineElementId({ id: "ghost", sourceFile: "index.html" }, [])).toBe(null);
  });

  it("resolves the correct repeated composition host by domId, not the first host sharing the same compositionSrc", () => {
    // Two hosts import the SAME sub-composition — only compositionSrc alone
    // can't tell them apart, but each still has its own domId (as any
    // element does). Selecting the SECOND host must not collapse to the
    // first one just because an earlier, unrelated element also happens to
    // share its compositionSrc.
    const els = [
      el({ id: "host-a", domId: "host-a", sourceFile: "index.html", compositionSrc: "scene.html" }),
      el({ id: "host-b", domId: "host-b", sourceFile: "index.html", compositionSrc: "scene.html" }),
    ];
    expect(
      findMatchingTimelineElementId(
        {
          id: "host-b",
          sourceFile: "index.html",
          compositionSrc: "scene.html",
          isCompositionHost: true,
        },
        els,
      ),
    ).toBe("host-b");
  });

  it("falls back to compositionSrc-only matching when the host selection has neither a domId nor a selector", () => {
    const els = [
      el({
        id: "host-only",
        domId: undefined,
        sourceFile: "index.html",
        compositionSrc: "scene.html",
      }),
    ];
    expect(
      findMatchingTimelineElementId(
        {
          id: undefined,
          sourceFile: "index.html",
          compositionSrc: "scene.html",
          isCompositionHost: true,
        },
        els,
      ),
    ).toBe("host-only");
  });
});

describe("findTimelineIdByAncestor", () => {
  const el = (over: Record<string, unknown>) =>
    ({ id: "x", start: 0, duration: 1, track: 0, tag: "div", ...over }) as never;

  it("resolves a static descendant (.num) to its nearest clip ancestor", () => {
    // #stat1 (a clip) > .num (selected, not a clip)
    const stat1 = document.createElement("div");
    stat1.id = "stat1";
    const num = document.createElement("div");
    num.className = "num";
    stat1.appendChild(num);

    const els = [el({ id: "stat1", domId: "stat1", key: "index.html#stat1" })];
    expect(findTimelineIdByAncestor(num, els, "index.html")).toBe("index.html#stat1");
  });

  it("returns null when no ancestor is a clip", () => {
    const wrap = document.createElement("div");
    const child = document.createElement("span");
    wrap.appendChild(child);
    expect(findTimelineIdByAncestor(child, [], "index.html")).toBe(null);
  });
});

describe("resolveTimelineIdForSelection", () => {
  const el = (over: Record<string, unknown>) =>
    ({ id: "x", start: 0, duration: 1, track: 0, tag: "div", ...over }) as never;

  it("resolves an ancestor clip against activeCompPath when the selection has no sourceFile", () => {
    // #card (a clip in a sub-composition) > .leaf (selected, not itself a clip)
    const card = document.createElement("div");
    card.id = "card";
    const leaf = document.createElement("span");
    leaf.className = "leaf";
    card.appendChild(leaf);

    const els = [
      el({
        id: "card",
        domId: "card",
        key: "comps/panel.html#card",
        sourceFile: "comps/panel.html",
      }),
    ];
    const selection = { element: leaf } as never;

    // Falling back to the active comp matches; the old index.html-only fallback would miss.
    expect(resolveTimelineIdForSelection(selection, els, "comps/panel.html")).toBe(
      "comps/panel.html#card",
    );
    expect(resolveTimelineIdForSelection(selection, els, null)).toBe(null);
  });
});

describe("resolveDroppedAssetDimensions", () => {
  it("aborts an image probe when metadata times out", async () => {
    vi.useFakeTimers();
    const probe = {
      addEventListener: vi.fn(),
      naturalHeight: 0,
      naturalWidth: 0,
      src: "",
    };
    vi.stubGlobal(
      "Image",
      vi.fn(() => probe),
    );

    const result = resolveDroppedAssetDimensions("demo", "assets/hung.png", "image");
    await vi.advanceTimersByTimeAsync(3000);

    await expect(result).resolves.toBeNull();
    expect(probe.src).toBe("");
  });

  it("aborts a video probe when metadata times out", async () => {
    vi.useFakeTimers();
    const video = document.createElement("video");
    const load = vi.fn();
    Object.defineProperty(video, "load", { configurable: true, value: load });
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName, options) =>
      tagName === "video" ? video : createElement(tagName, options),
    );

    const result = resolveDroppedAssetDimensions("demo", "assets/hung.mp4", "video");
    await vi.advanceTimersByTimeAsync(3000);

    await expect(result).resolves.toBeNull();
    expect(video.getAttribute("src")).toBe("");
    expect(load).toHaveBeenCalledOnce();
  });
});
