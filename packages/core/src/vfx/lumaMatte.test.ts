import { describe, expect, it } from "vitest";
import { LUMA_MATTE_FRAG, LUMA_MATTE_MODES } from "./lumaMatte.frag";
import { lumaMatteCoverageRef, lumaMatteSampleRef, type Rgba } from "./refs/lumaMatte";
import { getVfxDef, normalizeVfxParams } from "../vfx";

/** An opaque mid-grey source, premultiplied like the capture texture. */
const SRC: Rgba = { r: 0.4, g: 0.6, b: 0.8, a: 1 };
const OPAQUE_WHITE: Rgba = { r: 1, g: 1, b: 1, a: 1 };
const CLEAR: Rgba = { r: 0, g: 0, b: 0, a: 0 };

describe("luma-matte def", () => {
  it("is registered as a capturing kernel with a ref param and the real fragment source", () => {
    const def = getVfxDef("luma-matte")!;
    const ref = def.params.find((p) => p.kind === "ref");
    expect(def.capture).toBe("self");
    expect(ref?.key).toBe("matte");
    expect(def.frag).toBe(LUMA_MATTE_FRAG);
    expect(LUMA_MATTE_FRAG.startsWith("#version 300 es")).toBe(true);
    // The second source is what makes this kernel possible at all.
    expect(LUMA_MATTE_FRAG).toContain("uniform sampler2D u_src2;");
  });

  it("keeps a ref param's element id and falls back to empty for a non-string", () => {
    expect(normalizeVfxParams("luma-matte", { matte: "rw-matte-1" })["matte"]).toBe("rw-matte-1");
    expect(normalizeVfxParams("luma-matte", { matte: 7 })["matte"]).toBe("");
    expect(normalizeVfxParams("luma-matte", {})["matte"]).toBe("");
  });

  it("normalizes an unknown mode back to Alpha", () => {
    expect(normalizeVfxParams("luma-matte", { mode: 9 })["mode"]).toBe(LUMA_MATTE_MODES.alpha);
  });
});

describe("lumaMatteCoverageRef", () => {
  it("reads the matte's alpha, and its complement when inverted", () => {
    const matte: Rgba = { r: 0, g: 0, b: 0, a: 0.25 };
    expect(lumaMatteCoverageRef(matte, LUMA_MATTE_MODES.alpha)).toBe(0.25);
    expect(lumaMatteCoverageRef(matte, LUMA_MATTE_MODES.alphaInverted)).toBe(0.75);
  });

  it("reads luma as the matte composited over black", () => {
    // Premultiplied: a 50 % grey at 50 % opacity carries rgb 0.25, and After
    // Effects' luma matte sees exactly that — transparent is black, not absent.
    const half: Rgba = { r: 0.25, g: 0.25, b: 0.25, a: 0.5 };
    expect(lumaMatteCoverageRef(half, LUMA_MATTE_MODES.luma)).toBeCloseTo(0.25, 12);
    expect(lumaMatteCoverageRef(half, LUMA_MATTE_MODES.lumaInverted)).toBeCloseTo(0.75, 12);
  });

  it("weights the channels the way the Luminance channel selector does", () => {
    const red: Rgba = { r: 1, g: 0, b: 0, a: 1 };
    const green: Rgba = { r: 0, g: 1, b: 0, a: 1 };
    const blue: Rgba = { r: 0, g: 0, b: 1, a: 1 };
    const luma = (m: Rgba): number => lumaMatteCoverageRef(m, LUMA_MATTE_MODES.luma);
    expect(luma(green)).toBeGreaterThan(luma(red));
    expect(luma(red)).toBeGreaterThan(luma(blue));
    expect(luma(red) + luma(green) + luma(blue)).toBeCloseTo(1, 12);
  });
});

describe("lumaMatteSampleRef", () => {
  it("is the identity under a fully opaque alpha matte", () => {
    expect(lumaMatteSampleRef(SRC, OPAQUE_WHITE, 0, { mode: LUMA_MATTE_MODES.alpha })).toEqual(SRC);
  });

  it("empties the pixel — alpha included — where the matte does not cover", () => {
    expect(lumaMatteSampleRef(SRC, CLEAR, 0, { mode: LUMA_MATTE_MODES.alpha })).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 0,
    });
  });

  it("scales every channel by one coverage, keeping the pixel premultiplied", () => {
    const out = lumaMatteSampleRef(
      { r: 0.5, g: 0.5, b: 0.5, a: 0.5 },
      { r: 0, g: 0, b: 0, a: 0.5 },
      0,
      { mode: LUMA_MATTE_MODES.alpha },
    );
    // rgb <= a before, so rgb <= a after: a scalar multiply cannot break it.
    expect(out).toEqual({ r: 0.25, g: 0.25, b: 0.25, a: 0.25 });
  });

  it("inverts, so an opaque matte hides the layer under Alpha Inverted", () => {
    const out = lumaMatteSampleRef(SRC, OPAQUE_WHITE, 0, {
      mode: LUMA_MATTE_MODES.alphaInverted,
    });
    expect(out).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("is a pure function of its inputs", () => {
    const at = (): Rgba => lumaMatteSampleRef(SRC, OPAQUE_WHITE, 0.37, { mode: 3 });
    expect(at()).toEqual(at());
  });
});
