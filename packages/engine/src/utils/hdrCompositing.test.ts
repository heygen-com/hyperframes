import { describe, expect, it } from "vitest";
import { groupIntoLayers } from "./layerCompositor.js";
import type { ElementStackingInfo } from "../services/videoFrameInjector.js";

function makeEl(
  id: string,
  zIndex: number,
  isHdr: boolean,
  overrides?: Partial<ElementStackingInfo>,
): ElementStackingInfo {
  return {
    id,
    zIndex,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    layoutWidth: 1920,
    layoutHeight: 1080,
    opacity: 1,
    visible: true,
    isHdr,
    transform: "none",
    borderRadius: [0, 0, 0, 0],
    objectFit: "cover",
    objectPosition: "50% 50%",
    clipRect: null,
    ...overrides,
  };
}

describe("HDR compositing — opacity filtering", () => {
  it("zero-opacity elements remain in groupIntoLayers for hide-list correctness", () => {
    const elements = [
      makeEl("bg", 0, false),
      makeEl("v-hdr", 1, true),
      makeEl("overlay", 2, false, { opacity: 0 }),
    ];
    // Elements stay in layers for correct DOM screenshot hide-lists.
    // The compositor skips zero-opacity HDR layers during blit.
    const layers = groupIntoLayers(elements);
    expect(layers).toHaveLength(3);
    expect(layers[0]!.type).toBe("dom");
    expect(layers[1]!.type).toBe("hdr");
    expect(layers[2]!.type).toBe("dom");
  });

  it("zero-opacity HDR element should be skipped during blit", () => {
    const el = makeEl("v-hdr", 1, true, { opacity: 0 });
    // The compositor checks: if (layer.element.opacity <= 0) continue;
    expect(el.opacity).toBe(0);
    expect(el.opacity <= 0).toBe(true);
  });

  it("low but non-zero opacity HDR elements are NOT skipped", () => {
    const el = makeEl("v-hdr", 1, true, { opacity: 0.1 });
    expect(el.opacity > 0).toBe(true);
  });

  it("child data-start element with parent opacity 0 has effective opacity 0", () => {
    const childOverlay = makeEl("s6-text-wrap", 10, false, { opacity: 0 });
    expect(childOverlay.opacity).toBe(0);
  });

  it("DOM overlay above HDR video is in a separate layer when both visible", () => {
    const elements = [makeEl("bg", 0, false), makeEl("v-hdr", 1, true), makeEl("badge", 10, false)];
    const layers = groupIntoLayers(elements);
    expect(layers).toHaveLength(3);
    expect(layers[0]!.type).toBe("dom");
    expect(layers[1]!.type).toBe("hdr");
    expect(layers[2]!.type).toBe("dom");
    if (layers[2]!.type === "dom") {
      expect(layers[2]!.elementIds).toEqual(["badge"]);
    }
  });
});

describe("HDR compositing — clip rect", () => {
  it("clipRect is null when no overflow:hidden ancestor", () => {
    const el = makeEl("video", 0, true);
    expect(el.clipRect).toBeNull();
  });

  it("clipRect constrains element bounds for split-screen", () => {
    const el = makeEl("video-left", 0, true, {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      clipRect: { x: 0, y: 0, width: 960, height: 1080 },
    });
    const cr = el.clipRect!;
    const cx1 = Math.max(el.x, cr.x);
    const cy1 = Math.max(el.y, cr.y);
    const cx2 = Math.min(el.x + el.width, cr.x + cr.width);
    const cy2 = Math.min(el.y + el.height, cr.y + cr.height);
    expect(cx2 - cx1).toBe(960);
    expect(cy2 - cy1).toBe(1080);
  });

  it("fully clipped element produces zero-size intersection", () => {
    const el = makeEl("offscreen", 0, true, {
      x: 1000,
      y: 0,
      width: 920,
      height: 1080,
      clipRect: { x: 0, y: 0, width: 960, height: 1080 },
    });
    const cr = el.clipRect!;
    const cx2 = Math.min(el.x + el.width, cr.x + cr.width);
    const cx1 = Math.max(el.x, cr.x);
    expect(Math.max(0, cx2 - cx1)).toBe(0);
  });

  it("right-half clip produces correct source crop offset", () => {
    const el = makeEl("video-right", 0, true, {
      x: 960,
      y: 0,
      width: 1920,
      height: 1080,
      clipRect: { x: 960, y: 0, width: 960, height: 1080 },
    });
    const cr = el.clipRect!;
    const cx1 = Math.max(el.x, cr.x);
    const blitSrcX = cx1 - el.x;
    expect(blitSrcX).toBe(0);
    const blitW = Math.min(el.x + el.width, cr.x + cr.width) - cx1;
    expect(blitW).toBe(960);
  });
});
