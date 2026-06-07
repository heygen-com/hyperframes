// @vitest-environment happy-dom

import { describe, it, expect } from "vitest";
import type { PatchOperation } from "../../utils/sourcePatcher";
import {
  STUDIO_OFFSET_X_PROP,
  STUDIO_OFFSET_Y_PROP,
  STUDIO_WIDTH_PROP,
  STUDIO_HEIGHT_PROP,
  STUDIO_PATH_OFFSET_ATTR,
  STUDIO_BOX_SIZE_ATTR,
  STUDIO_ORIGINAL_TRANSLATE_ATTR,
  STUDIO_ORIGINAL_INLINE_TRANSLATE_ATTR,
  STUDIO_ORIGINAL_WIDTH_ATTR,
  STUDIO_ORIGINAL_HEIGHT_ATTR,
  STUDIO_ORIGINAL_MIN_WIDTH_ATTR,
  STUDIO_ORIGINAL_MIN_HEIGHT_ATTR,
  STUDIO_ORIGINAL_MAX_WIDTH_ATTR,
  STUDIO_ORIGINAL_MAX_HEIGHT_ATTR,
  STUDIO_ORIGINAL_FLEX_BASIS_ATTR,
  STUDIO_ORIGINAL_FLEX_GROW_ATTR,
  STUDIO_ORIGINAL_FLEX_SHRINK_ATTR,
  STUDIO_ORIGINAL_BOX_SIZING_ATTR,
  STUDIO_ORIGINAL_SCALE_ATTR,
  STUDIO_ORIGINAL_TRANSFORM_ORIGIN_ATTR,
  STUDIO_ORIGINAL_DISPLAY_ATTR,
  STUDIO_ORIGINAL_TRANSFORM_DISPLAY_ATTR,
} from "./manualEditsTypes";
import {
  buildPathOffsetPatches,
  buildClearPathOffsetPatches,
  buildBoxSizePatches,
  buildClearBoxSizePatches,
} from "./manualEditsDomPatches";

/* ── helpers ── */

function div(): HTMLElement {
  return document.createElement("div");
}

function opKey(op: PatchOperation): string {
  return `${op.type}:${op.property}`;
}

function assertClearCoversKeys(buildOps: PatchOperation[], clearOps: PatchOperation[]): void {
  const clearKeys = new Set(clearOps.map(opKey));
  for (const op of buildOps) {
    expect(clearKeys.has(opKey(op)), `clear missing key "${opKey(op)}"`).toBe(true);
  }
}

/* ── Path offset ─────────────────────────────────────────────────────────── */

describe("buildPathOffsetPatches / buildClearPathOffsetPatches", () => {
  function populatedPathEl(): HTMLElement {
    const e = div();
    e.style.setProperty(STUDIO_OFFSET_X_PROP, "10px");
    e.style.setProperty(STUDIO_OFFSET_Y_PROP, "20px");
    e.style.setProperty("translate", "10px 20px");
    e.setAttribute(STUDIO_ORIGINAL_TRANSLATE_ATTR, "5px 10px");
    e.setAttribute(STUDIO_ORIGINAL_INLINE_TRANSLATE_ATTR, "3px");
    e.style.setProperty("display", "flex");
    e.setAttribute(STUDIO_ORIGINAL_TRANSFORM_DISPLAY_ATTR, "block");
    return e;
  }

  it("populated: captures offset styles, attrs, display, and transform-display marker in declaration order", () => {
    const ops = buildPathOffsetPatches(populatedPathEl());
    expect(ops).toEqual([
      { type: "inline-style", property: STUDIO_OFFSET_X_PROP, value: "10px" },
      { type: "inline-style", property: STUDIO_OFFSET_Y_PROP, value: "20px" },
      { type: "inline-style", property: "translate", value: "10px 20px" },
      { type: "attribute", property: STUDIO_PATH_OFFSET_ATTR, value: "true" },
      { type: "attribute", property: STUDIO_ORIGINAL_TRANSLATE_ATTR, value: "5px 10px" },
      { type: "attribute", property: STUDIO_ORIGINAL_INLINE_TRANSLATE_ATTR, value: "3px" },
      { type: "inline-style", property: "display", value: "flex" },
      { type: "attribute", property: STUDIO_ORIGINAL_TRANSFORM_DISPLAY_ATTR, value: "block" },
    ]);
  });

  it("empty: bare element yields only the path-offset marker", () => {
    expect(buildPathOffsetPatches(div())).toEqual([
      { type: "attribute", property: STUDIO_PATH_OFFSET_ATTR, value: "true" },
    ]);
  });

  it("clear: restores translate from STUDIO_ORIGINAL_INLINE_TRANSLATE_ATTR and display from STUDIO_ORIGINAL_TRANSFORM_DISPLAY_ATTR", () => {
    const e = div();
    e.setAttribute(STUDIO_ORIGINAL_INLINE_TRANSLATE_ATTR, "5px");
    e.setAttribute(STUDIO_ORIGINAL_TRANSFORM_DISPLAY_ATTR, "grid");
    const ops = buildClearPathOffsetPatches(e);
    expect(ops).toEqual([
      { type: "inline-style", property: STUDIO_OFFSET_X_PROP, value: null },
      { type: "inline-style", property: STUDIO_OFFSET_Y_PROP, value: null },
      { type: "inline-style", property: "translate", value: "5px" },
      { type: "attribute", property: STUDIO_PATH_OFFSET_ATTR, value: null },
      { type: "attribute", property: STUDIO_ORIGINAL_TRANSLATE_ATTR, value: null },
      { type: "attribute", property: STUDIO_ORIGINAL_INLINE_TRANSLATE_ATTR, value: null },
      { type: "inline-style", property: "display", value: "grid" },
      { type: "attribute", property: STUDIO_ORIGINAL_TRANSFORM_DISPLAY_ATTR, value: null },
    ]);
  });

  it("build/clear symmetry: clear addresses every {type,property} key that build emits", () => {
    const e = populatedPathEl();
    assertClearCoversKeys(buildPathOffsetPatches(e), buildClearPathOffsetPatches(e));
  });
});

/* ── Box size ────────────────────────────────────────────────────────────── */

describe("buildBoxSizePatches / buildClearBoxSizePatches", () => {
  function populatedBoxEl(): HTMLElement {
    const e = div();
    e.style.setProperty(STUDIO_WIDTH_PROP, "300px");
    e.style.setProperty(STUDIO_HEIGHT_PROP, "200px");
    e.style.setProperty("width", "300px");
    e.style.setProperty("height", "200px");
    e.style.setProperty("min-width", "100px");
    e.style.setProperty("min-height", "50px");
    e.style.setProperty("max-width", "500px");
    e.style.setProperty("max-height", "400px");
    e.style.setProperty("flex-basis", "auto");
    e.style.setProperty("flex-grow", "1");
    e.style.setProperty("flex-shrink", "0");
    e.style.setProperty("box-sizing", "border-box");
    e.style.setProperty("scale", "1.5");
    e.style.setProperty("transform-origin", "center");
    e.style.setProperty("display", "block");
    e.setAttribute(STUDIO_ORIGINAL_WIDTH_ATTR, "250px");
    e.setAttribute(STUDIO_ORIGINAL_HEIGHT_ATTR, "150px");
    e.setAttribute(STUDIO_ORIGINAL_MIN_WIDTH_ATTR, "0px");
    e.setAttribute(STUDIO_ORIGINAL_MIN_HEIGHT_ATTR, "0px");
    e.setAttribute(STUDIO_ORIGINAL_MAX_WIDTH_ATTR, "none");
    e.setAttribute(STUDIO_ORIGINAL_MAX_HEIGHT_ATTR, "none");
    e.setAttribute(STUDIO_ORIGINAL_FLEX_BASIS_ATTR, "0px");
    e.setAttribute(STUDIO_ORIGINAL_FLEX_GROW_ATTR, "0");
    e.setAttribute(STUDIO_ORIGINAL_FLEX_SHRINK_ATTR, "1");
    e.setAttribute(STUDIO_ORIGINAL_BOX_SIZING_ATTR, "content-box");
    e.setAttribute(STUDIO_ORIGINAL_SCALE_ATTR, "1");
    e.setAttribute(STUDIO_ORIGINAL_TRANSFORM_ORIGIN_ATTR, "50% 50%");
    e.setAttribute(STUDIO_ORIGINAL_DISPLAY_ATTR, "flex");
    e.setAttribute(STUDIO_ORIGINAL_TRANSFORM_DISPLAY_ATTR, "");
    return e;
  }

  it("populated: captures studio-width/height, all BOX_SIZE_STYLE_PROPS, marker, and all orig attrs", () => {
    const ops = buildBoxSizePatches(populatedBoxEl());
    expect(ops).toEqual([
      { type: "inline-style", property: STUDIO_WIDTH_PROP, value: "300px" },
      { type: "inline-style", property: STUDIO_HEIGHT_PROP, value: "200px" },
      { type: "inline-style", property: "width", value: "300px" },
      { type: "inline-style", property: "height", value: "200px" },
      { type: "inline-style", property: "min-width", value: "100px" },
      { type: "inline-style", property: "min-height", value: "50px" },
      { type: "inline-style", property: "max-width", value: "500px" },
      { type: "inline-style", property: "max-height", value: "400px" },
      { type: "inline-style", property: "flex-basis", value: "auto" },
      { type: "inline-style", property: "flex-grow", value: "1" },
      { type: "inline-style", property: "flex-shrink", value: "0" },
      { type: "inline-style", property: "box-sizing", value: "border-box" },
      { type: "inline-style", property: "scale", value: "1.5" },
      { type: "inline-style", property: "transform-origin", value: "center" },
      { type: "inline-style", property: "display", value: "block" },
      { type: "attribute", property: STUDIO_BOX_SIZE_ATTR, value: "true" },
      { type: "attribute", property: STUDIO_ORIGINAL_WIDTH_ATTR, value: "250px" },
      { type: "attribute", property: STUDIO_ORIGINAL_HEIGHT_ATTR, value: "150px" },
      { type: "attribute", property: STUDIO_ORIGINAL_MIN_WIDTH_ATTR, value: "0px" },
      { type: "attribute", property: STUDIO_ORIGINAL_MIN_HEIGHT_ATTR, value: "0px" },
      { type: "attribute", property: STUDIO_ORIGINAL_MAX_WIDTH_ATTR, value: "none" },
      { type: "attribute", property: STUDIO_ORIGINAL_MAX_HEIGHT_ATTR, value: "none" },
      { type: "attribute", property: STUDIO_ORIGINAL_FLEX_BASIS_ATTR, value: "0px" },
      { type: "attribute", property: STUDIO_ORIGINAL_FLEX_GROW_ATTR, value: "0" },
      { type: "attribute", property: STUDIO_ORIGINAL_FLEX_SHRINK_ATTR, value: "1" },
      { type: "attribute", property: STUDIO_ORIGINAL_BOX_SIZING_ATTR, value: "content-box" },
      { type: "attribute", property: STUDIO_ORIGINAL_SCALE_ATTR, value: "1" },
      { type: "attribute", property: STUDIO_ORIGINAL_TRANSFORM_ORIGIN_ATTR, value: "50% 50%" },
      { type: "attribute", property: STUDIO_ORIGINAL_DISPLAY_ATTR, value: "flex" },
      { type: "attribute", property: STUDIO_ORIGINAL_TRANSFORM_DISPLAY_ATTR, value: "" },
    ]);
  });

  it("empty: bare element yields only the box-size marker", () => {
    expect(buildBoxSizePatches(div())).toEqual([
      { type: "attribute", property: STUDIO_BOX_SIZE_ATTR, value: "true" },
    ]);
  });

  it("clear: restores width and height from orig attrs, nulls all orig attrs", () => {
    const e = div();
    e.setAttribute(STUDIO_ORIGINAL_WIDTH_ATTR, "200px");
    e.setAttribute(STUDIO_ORIGINAL_HEIGHT_ATTR, "100px");
    const ops = buildClearBoxSizePatches(e);
    expect(ops).toEqual(
      expect.arrayContaining([
        { type: "inline-style", property: STUDIO_WIDTH_PROP, value: null },
        { type: "inline-style", property: STUDIO_HEIGHT_PROP, value: null },
        { type: "attribute", property: STUDIO_BOX_SIZE_ATTR, value: null },
        { type: "inline-style", property: "width", value: "200px" },
        { type: "attribute", property: STUDIO_ORIGINAL_WIDTH_ATTR, value: null },
        { type: "inline-style", property: "height", value: "100px" },
        { type: "attribute", property: STUDIO_ORIGINAL_HEIGHT_ATTR, value: null },
      ]),
    );
  });

  it("build/clear symmetry: clear addresses every {type,property} key that build emits", () => {
    const e = populatedBoxEl();
    assertClearCoversKeys(buildBoxSizePatches(e), buildClearBoxSizePatches(e));
  });
});
