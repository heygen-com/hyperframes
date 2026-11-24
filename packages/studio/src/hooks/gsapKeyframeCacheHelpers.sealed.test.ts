// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";

const { previewDocumentCopy, previewFrameOpaque } = vi.hoisted(() => ({
  previewDocumentCopy: vi.fn(),
  previewFrameOpaque: vi.fn(),
}));
vi.mock("../player/lib/previewChannel", async (importOriginal) => {
  const original = await importOriginal<typeof import("../player/lib/previewChannel")>();
  return { ...original, previewFrameOpaque, previewDocumentCopy };
});

import { usePlayerStore } from "../player/store/playerStore";
import { cacheCommittedKeyframes } from "./gsapKeyframeCacheHelpers";

const iframe = document.createElement("iframe");
const dots: GsapAnimation = {
  id: "dots",
  targetSelector: ".dot",
  method: "to",
  position: 0,
  properties: {},
  duration: 4,
  resolvedStart: 0,
  propertyGroup: "position",
  keyframes: { format: "percentage", keyframes: [{ percentage: 50, properties: { x: 100 } }] },
};
const shown = {
  format: "percentage" as const,
  keyframes: [{ percentage: 10, properties: { x: 1 } }],
};

beforeEach(() => {
  previewDocumentCopy.mockReset();
  previewFrameOpaque.mockReset().mockReturnValue(true);
  usePlayerStore.setState({
    keyframeCache: new Map([["index.html#d1", shown]]),
    gsapAnimations: new Map(),
    elements: [],
  });
});

it("files a class tween under the sealed frame's matching elements", async () => {
  const markup = '<div id="d1" class="dot"></div><div id="d2" class="dot"></div><div id="x"></div>';
  previewDocumentCopy.mockResolvedValue(new DOMParser().parseFromString(markup, "text/html"));
  await cacheCommittedKeyframes(iframe, [dots], "index.html", "d1", {});
  expect(previewDocumentCopy).toHaveBeenCalledWith(iframe);
  const keys = [...usePlayerStore.getState().keyframeCache.keys()].filter((k) => k.includes("#"));
  expect(keys.sort()).toEqual(["index.html#d1", "index.html#d2"]);
});

it("keeps the shown markers when the sealed frame does not answer", async () => {
  previewDocumentCopy.mockResolvedValue(null);
  await cacheCommittedKeyframes(iframe, [dots], "index.html", "d1", {});
  expect(usePlayerStore.getState().keyframeCache.get("index.html#d1")).toBe(shown);
});

it("keeps the shown markers when the sealed frame is removed while it is read", async () => {
  previewDocumentCopy.mockImplementation(async () => {
    previewFrameOpaque.mockReturnValue(false);
    return null;
  });
  await cacheCommittedKeyframes(iframe, [dots], "index.html", "d1", {});
  expect(usePlayerStore.getState().keyframeCache.get("index.html#d1")).toBe(shown);
});
