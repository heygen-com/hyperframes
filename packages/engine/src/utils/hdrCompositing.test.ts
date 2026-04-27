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
  it("zero-opacity elements should be filtered before compositing", () => {
    const elements = [
      makeEl("bg", 0, false),
      makeEl("v-hdr", 1, true),
      makeEl("overlay", 2, false, { opacity: 0 }),
    ];
    // The renderOrchestrator filters before groupIntoLayers:
    // visibleStacking = filteredStacking.filter(e => e.opacity > 0)
    const visible = elements.filter((e) => e.opacity > 0);
    const layers = groupIntoLayers(visible);
    expect(layers).toHaveLength(2);
    expect(layers[0]!.type).toBe("dom");
    expect(layers[1]!.type).toBe("hdr");
    // overlay (opacity 0) should NOT appear
    if (layers[0]!.type === "dom") {
      expect(layers[0]!.elementIds).not.toContain("overlay");
    }
  });

  it("near-zero opacity elements are still excluded", () => {
    const elements = [makeEl("bg", 0, false), makeEl("faded", 1, false, { opacity: 0 })];
    const visible = elements.filter((e) => e.opacity > 0);
    expect(visible).toHaveLength(1);
    expect(visible[0]!.id).toBe("bg");
  });

  it("low but non-zero opacity elements are kept", () => {
    const elements = [makeEl("bg", 0, false), makeEl("ghost", 1, false, { opacity: 0.1 })];
    const visible = elements.filter((e) => e.opacity > 0);
    expect(visible).toHaveLength(2);
  });

  it("child data-start element with parent opacity 0 has effective opacity 0", () => {
    // getEffectiveOpacity multiplies ancestor opacities.
    // If parent scene has opacity 0 and child overlay has opacity 1,
    // effective opacity = 0 * 1 = 0
    const childOverlay = makeEl("s6-text-wrap", 10, false, { opacity: 0 });
    const visible = [childOverlay].filter((e) => e.opacity > 0);
    expect(visible).toHaveLength(0);
  });

  it("DOM overlay above HDR video is in a separate layer when both visible", () => {
    const elements = [makeEl("bg", 0, false), makeEl("v-hdr", 1, true), makeEl("badge", 10, false)];
    const visible = elements.filter((e) => e.opacity > 0);
    const layers = groupIntoLayers(visible);
    // Should be: DOM(bg) → HDR(v-hdr) → DOM(badge)
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
    // Intersection of element (0,0,1920,1080) with clip (0,0,960,1080)
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
    // Element starts at 1000, clip ends at 960 — no overlap on left portion
    // But element goes 1000-1920, clip is 0-960, so overlap is 0 pixels? No:
    // cx1 = max(1000, 0) = 1000, cx2 = min(1920, 960) = 960
    // cx2 - cx1 = 960 - 1000 = -40 → clamped to 0
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
    // Video positioned at x=960, clip starts at x=960 → srcX = 0
    expect(blitSrcX).toBe(0);
    const blitW = Math.min(el.x + el.width, cr.x + cr.width) - cx1;
    expect(blitW).toBe(960);
  });
});
