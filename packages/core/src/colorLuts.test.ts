import { describe, expect, it } from "vitest";
import { CubeLutParseError, packCubeLutToRgba8, parseCubeLut } from "./colorLuts";

const IDENTITY_2 = `
# comment
TITLE "Identity 2"
DOMAIN_MIN 0 0 0
DOMAIN_MAX 1 1 1
LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`;

describe("cube LUT parsing", () => {
  it("parses a 3D cube LUT with title, domain, and red-fastest data order", () => {
    const lut = parseCubeLut(IDENTITY_2);

    expect(lut.title).toBe("Identity 2");
    expect(lut.size).toBe(2);
    expect(lut.domainMin).toEqual([0, 0, 0]);
    expect(lut.domainMax).toEqual([1, 1, 1]);
    expect(Array.from(lut.data.slice(0, 12))).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
  });

  it("packs 3D LUT data into a WebGL1-friendly 2D RGBA texture", () => {
    const packed = packCubeLutToRgba8(parseCubeLut(IDENTITY_2));

    expect(packed.width).toBe(4);
    expect(packed.height).toBe(2);
    expect(Array.from(packed.data.slice(0, 16))).toEqual([
      0, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 255, 0, 255, 255,
    ]);
  });

  it("accepts DaVinci/IRIDAS-style 3D input ranges", () => {
    const lut = parseCubeLut(`
      TITLE "Resolve Range"
      LUT_3D_SIZE 2
      LUT_3D_INPUT_RANGE 0 1
      0 0 0
      1 0 0
      0 1 0
      1 1 0
      0 0 1
      1 0 1
      0 1 1
      1 1 1
    `);

    expect(lut.title).toBe("Resolve Range");
    expect(lut.domainMin).toEqual([0, 0, 0]);
    expect(lut.domainMax).toEqual([1, 1, 1]);
  });

  it("rejects inverted 3D input ranges at the range line", () => {
    expect(() =>
      parseCubeLut(`
        LUT_3D_SIZE 2
        LUT_3D_INPUT_RANGE 1 0
      `),
    ).toThrow("LUT_3D_INPUT_RANGE max must exceed min");
  });

  it("rejects unsupported 1D cube LUTs", () => {
    expect(() =>
      parseCubeLut(`
        LUT_1D_SIZE 2
        0 0 0
        1 1 1
      `),
    ).toThrow("1D cube LUTs are not supported yet");
  });

  it("rejects mixed 1D and 3D cube LUTs", () => {
    expect(() =>
      parseCubeLut(`
        LUT_1D_SIZE 2
        LUT_3D_SIZE 2
        0 0 0
        1 0 0
        0 1 0
        1 1 0
        0 0 1
        1 0 1
        0 1 1
        1 1 1
      `),
    ).toThrow("Mixed 1D and 3D cube LUTs are not supported yet");
  });

  it("rejects row count mismatches and oversize LUTs", () => {
    expect(() =>
      parseCubeLut(`
        LUT_3D_SIZE 2
        0 0 0
      `),
    ).toThrow("Expected 8 LUT rows");

    expect(() => parseCubeLut("LUT_3D_SIZE 65", { maxSize: 64 })).toThrow(
      "LUT_3D_SIZE 65 exceeds max 64",
    );
  });

  it("reports invalid numbers as cube parse errors", () => {
    expect(() =>
      parseCubeLut(`
        LUT_3D_SIZE 2
        nope 0 0
      `),
    ).toThrow(CubeLutParseError);
  });
});
