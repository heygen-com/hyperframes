import { describe, expect, it } from "vitest";
import { DISPLACEMENT_MAP_FRAG } from "./displacementMap.frag";
import { displacementMapSampleRef, type MapSampler } from "./refs/displacementMap";
import { getVfxDef, normalizeVfxParams } from "../vfx";

const P = { x: 137, y: 61 };
/** retro-wave: Use For Horizontal = Red, Use For Vertical = Green. */
const RETRO = { useH: 1, useV: 2, behavior: 1, edge: 0, expand: true };

const uniform =
  (r: number, g: number, b: number, a = 1): MapSampler =>
  () => ({ r, g, b, a });

const MID_GREY = uniform(0.5, 0.5, 0.5);
const PURE_RED = uniform(1, 0, 0);

describe("displacement-map def", () => {
  it("is registered as a self-capture kernel with the real fragment source", () => {
    const def = getVfxDef("displacement-map")!;
    expect(def.capture).toBe("self");
    expect(def.ae).toBe("ADBE Displacement Map");
    expect(def.frag).toBe(DISPLACEMENT_MAP_FRAG);
    expect(DISPLACEMENT_MAP_FRAG.startsWith("#version 300 es")).toBe(true);
  });

  it("normalizes the unimplemented behaviour and edge modes back to the v1 pair", () => {
    const p = normalizeVfxParams("displacement-map", { behavior: 3, edge: 1 });
    expect(p["behavior"]).toBe(1);
    expect(p["edge"]).toBe(0);
  });

  it("keeps Hue, Lightness and Saturation as selectable channels", () => {
    // The kernel reads them as Luminance rather than dropping them back to the
    // param's default, which for Use For Horizontal would be Red.
    for (const value of [6, 7, 8]) {
      expect(normalizeVfxParams("displacement-map", { useH: value })["useH"]).toBe(value);
    }
  });
});

describe("displacementMapSampleRef", () => {
  it("is the identity when both maxima are zero, whatever the map says", () => {
    expect(displacementMapSampleRef(P, 0, { ...RETRO, maxH: 0, maxV: 0 }, PURE_RED)).toEqual(P);
  });

  it("is the identity for a mid-grey map at any maximum", () => {
    expect(displacementMapSampleRef(P, 0, { ...RETRO, maxH: 150, maxV: 309 }, MID_GREY)).toEqual(P);
  });

  it("shifts by +maxH for a pure-red map on the red channel", () => {
    const s = displacementMapSampleRef(P, 0, { ...RETRO, maxH: 150, maxV: 0 }, PURE_RED);
    expect(s.x).toBeCloseTo(P.x + 150, 10);
    expect(s.y).toBe(P.y);
  });

  it("shifts by −maxV when the vertical channel reads zero", () => {
    const s = displacementMapSampleRef(P, 0, { ...RETRO, maxH: 0, maxV: 309 }, PURE_RED);
    expect(s.y).toBeCloseTo(P.y - 309, 10);
  });

  it("reads Full as +max, Half and Off as no displacement", () => {
    const at = (useH: number): number =>
      displacementMapSampleRef(P, 0, { ...RETRO, useH, maxH: 100, maxV: 0 }, uniform(0, 0, 0)).x;
    expect(at(9)).toBeCloseTo(P.x + 100, 10);
    expect(at(10)).toBe(P.x);
    expect(at(11)).toBe(P.x);
  });

  it("reads Hue, Lightness and Saturation as Luminance", () => {
    const at = (useH: number): number =>
      displacementMapSampleRef(P, 0, { ...RETRO, useH, maxH: 100, maxV: 0 }, uniform(1, 0.5, 0.2))
        .x;
    for (const value of [6, 7, 8]) expect(at(value)).toBeCloseTo(at(5), 10);
  });

  it("unpremultiplies the map before reading a colour channel", () => {
    // The capture texture is premultiplied, so a half-transparent pure red
    // arrives as (0.5, 0, 0, 0.5) and must still read as red = 1.
    const premultipliedRed = uniform(0.5, 0, 0, 0.5);
    expect(
      displacementMapSampleRef(P, 0, { ...RETRO, maxH: 100, maxV: 0 }, premultipliedRed).x,
    ).toBeCloseTo(P.x + 100, 10);
  });

  it("reads alpha straight, without unpremultiplying it", () => {
    const s = displacementMapSampleRef(
      P,
      0,
      { ...RETRO, useH: 4, maxH: 100, maxV: 0 },
      uniform(0, 0, 0, 1),
    );
    expect(s.x).toBeCloseTo(P.x + 100, 10);
  });

  it("is a pure function of its inputs", () => {
    const at = () =>
      displacementMapSampleRef(P, 0.37, { ...RETRO, maxH: 150, maxV: 309 }, PURE_RED);
    expect(at()).toEqual(at());
  });
});
