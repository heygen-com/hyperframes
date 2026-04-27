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

describe("groupIntoLayers", () => {
  it("single DOM element → 1 DOM layer", () => {
    const layers = groupIntoLayers([makeEl("text", 0, false)]);
    expect(layers).toHaveLength(1);
    expect(layers[0]!.type).toBe("dom");
  });

  it("single HDR element → 1 HDR layer", () => {
    const layers = groupIntoLayers([makeEl("v-hdr", 0, true)]);
    expect(layers).toHaveLength(1);
    expect(layers[0]!.type).toBe("hdr");
  });

  it("merges adjacent DOM elements into one layer", () => {
    const elements = [makeEl("bg", 0, false), makeEl("text", 1, false), makeEl("logo", 2, false)];
    const layers = groupIntoLayers(elements);
    expect(layers).toHaveLength(1);
    expect(layers[0]!.type).toBe("dom");
    if (layers[0]!.type === "dom") {
      expect(layers[0]!.elementIds).toEqual(["bg", "text", "logo"]);
    }
  });

  it("splits on HDR/DOM boundary: DOM → HDR → DOM = 3 layers", () => {
    const elements = [makeEl("bg", 0, false), makeEl("v-hdr", 1, true), makeEl("title", 2, false)];
    const layers = groupIntoLayers(elements);
    expect(layers).toHaveLength(3);
    expect(layers[0]!.type).toBe("dom");
    expect(layers[1]!.type).toBe("hdr");
    expect(layers[2]!.type).toBe("dom");
  });

  it("merges adjacent DOM around multiple HDR: DOM → HDR → HDR → DOM = 4 layers", () => {
    const elements = [
      makeEl("bg", 0, false),
      makeEl("v-hdr1", 1, true),
      makeEl("v-hdr2", 2, true),
      makeEl("title", 3, false),
    ];
    const layers = groupIntoLayers(elements);
    expect(layers).toHaveLength(4);
    expect(layers[0]!.type).toBe("dom");
    expect(layers[1]!.type).toBe("hdr");
    expect(layers[2]!.type).toBe("hdr");
    expect(layers[3]!.type).toBe("dom");
  });

  it("complex case: DOM DOM HDR DOM HDR DOM = 5 layers (2 DOM merges)", () => {
    const elements = [
      makeEl("bg", 0, false),
      makeEl("caption", 1, false),
      makeEl("v-hdr1", 2, true),
      makeEl("text", 3, false),
      makeEl("v-hdr2", 4, true),
      makeEl("logo", 5, false),
    ];
    const layers = groupIntoLayers(elements);
    expect(layers).toHaveLength(5);
    expect(layers.map((l) => l.type)).toEqual(["dom", "hdr", "dom", "hdr", "dom"]);
    if (layers[0]!.type === "dom") {
      expect(layers[0]!.elementIds).toEqual(["bg", "caption"]);
    }
  });

  it("sorts by zIndex before grouping", () => {
    const elements = [makeEl("title", 5, false), makeEl("v-hdr", 2, true), makeEl("bg", 0, false)];
    const layers = groupIntoLayers(elements);
    expect(layers).toHaveLength(3);
    expect(layers[0]!.type).toBe("dom"); // bg (z=0)
    expect(layers[1]!.type).toBe("hdr"); // v-hdr (z=2)
    expect(layers[2]!.type).toBe("dom"); // title (z=5)
  });

  it("includes invisible elements in correct z-position", () => {
    const elements = [
      makeEl("bg", 0, false),
      { ...makeEl("hidden-sdr", 1, false), visible: false },
      { ...makeEl("hidden-hdr", 2, true), visible: false },
      makeEl("title", 3, false),
    ];
    const layers = groupIntoLayers(elements);
    // All elements included — invisible SDR videos need their injected
    // <img> replacements hidden from other layers' screenshots
    expect(layers).toHaveLength(3);
    expect(layers[0]!.type).toBe("dom"); // bg + hidden-sdr (merged)
    expect(layers[1]!.type).toBe("hdr"); // hidden-hdr
    expect(layers[2]!.type).toBe("dom"); // title
    if (layers[0]!.type === "dom") {
      expect(layers[0]!.elementIds).toEqual(["bg", "hidden-sdr"]);
    }
  });

  it("returns an empty array for empty input", () => {
    expect(groupIntoLayers([])).toEqual([]);
  });

  it("handles negative z-index (valid CSS back layers)", () => {
    const elements = [makeEl("fg", 1, false), makeEl("bg", -5, false)];
    const layers = groupIntoLayers(elements);
    expect(layers).toHaveLength(1);
    expect(layers[0]!.type).toBe("dom");
    if (layers[0]!.type === "dom") {
      expect(layers[0]!.elementIds).toEqual(["bg", "fg"]);
    }
  });

  it("preserves input order for equal z-index (stable tie-break)", () => {
    const elements = [
      makeEl("first", 0, false),
      makeEl("second", 0, false),
      makeEl("third", 0, false),
    ];
    const layers = groupIntoLayers(elements);
    expect(layers).toHaveLength(1);
    if (layers[0]!.type === "dom") {
      expect(layers[0]!.elementIds).toEqual(["first", "second", "third"]);
    }
  });
});
