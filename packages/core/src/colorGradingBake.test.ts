import { describe, expect, it } from "vitest";
import { bakeHfColorGradingCube } from "./colorGradingBake";
import { normalizeHfColorGrading, type HfColorGrading } from "./colorGrading";
import { parseCubeLut } from "./colorLuts";

function bakedRows(cube: string): number[][] {
  return cube
    .trim()
    .split("\n")
    .slice(3)
    .map((row) => row.split(" ").map(Number));
}

function latticePoint(index: number, size: number): [number, number, number] {
  const step = size - 1;
  return [
    (index % size) / step,
    (Math.floor(index / size) % size) / step,
    Math.floor(index / (size * size)) / step,
  ];
}

function bakedAt(grading: HfColorGrading, size: number, rgb: readonly number[]): number[] {
  const step = size - 1;
  const [r = 0, g = 0, b = 0] = rgb.map((value) => Math.round(value * step));
  const row = bakedRows(bakeHfColorGradingCube(grading, { size }))[(b * size + g) * size + r];
  if (!row) throw new Error(`no row for ${rgb.join(",")}`);
  return row;
}

function expectRgbClose(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(3);
  actual.forEach((value, channel) => expect(value).toBeCloseTo(expected[channel] ?? NaN, 5));
}

const LUMA = [0.2126, 0.7152, 0.0722] as const;

describe("bakeHfColorGradingCube", () => {
  it("writes the header and one red-fastest row per lattice point", () => {
    const cube = bakeHfColorGradingCube({}, { size: 3 });
    const lines = cube.trim().split("\n");

    expect(lines.slice(0, 3)).toEqual(["LUT_3D_SIZE 3", "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1"]);
    expect(lines).toHaveLength(3 + 27);
    expect(lines[3]).toBe("0.000000 0.000000 0.000000");
    expect(lines[4]).toBe("0.500000 0.000000 0.000000");
    expect(lines[6]).toBe("0.000000 0.500000 0.000000");
    expect(lines[12]).toBe("0.000000 0.000000 0.500000");
    expect(parseCubeLut(cube).size).toBe(3);
  });

  it("defaults to a 33-point cube", () => {
    expect(bakedRows(bakeHfColorGradingCube({}))).toHaveLength(33 ** 3);
  });

  it.each([
    ["an empty grading", {}],
    ["a disabled grading", { enabled: false, adjust: { exposure: 1 } }],
    ["a grading at intensity 0", { intensity: 0, adjust: { exposure: 1, saturation: -1 } }],
    ["a resolved neutral grading", normalizeHfColorGrading({}) ?? {}],
  ] satisfies [string, HfColorGrading][])("bakes %s as the identity cube", (_name, grading) => {
    const size = 17;
    bakedRows(bakeHfColorGradingCube(grading, { size })).forEach((row, index) => {
      const point = latticePoint(index, size);
      row.forEach((value, channel) =>
        expect(Math.abs(value - (point[channel] ?? NaN))).toBeLessThanOrEqual(1e-6),
      );
    });
  });

  it("applies the primary controls as the shader's formulas do", () => {
    expectRgbClose(bakedAt({ adjust: { exposure: 1 } }, 5, [0.25, 0.25, 0.25]), [0.5, 0.5, 0.5]);
    expectRgbClose(bakedAt({ adjust: { exposure: 1 } }, 5, [0.75, 0.25, 0]), [1, 0.5, 0]);
    expectRgbClose(
      bakedAt({ adjust: { contrast: 0.5 } }, 5, [0.25, 0.75, 0.5]),
      [0.125, 0.875, 0.5],
    );
    expectRgbClose(
      bakedAt({ adjust: { temperature: 0.5 } }, 5, [0.5, 0.5, 0.5]),
      [0.54, 0.5, 0.46],
    );
    expectRgbClose(bakedAt({ adjust: { tint: 0.5 } }, 5, [0.5, 0.5, 0.5]), [0.52, 0.46, 0.52]);
    expectRgbClose(bakedAt({ adjust: { saturation: -1 } }, 5, [1, 0, 0]), [
      LUMA[0],
      LUMA[0],
      LUMA[0],
    ]);
    // whites 0.5 moves the white point to 0.91: 0.5 / 0.91.
    expectRgbClose(bakedAt({ adjust: { whites: 0.5 } }, 5, [0.5, 0.5, 0.5]), [
      0.5 / 0.91,
      0.5 / 0.91,
      0.5 / 0.91,
    ]);
    // shadows lifts by 0.35 * (1 - smoothstep(0, 0.65, luma)); at luma 0.25, t = 0.25 / 0.65.
    const t = 0.25 / 0.65;
    const lift = 0.35 * 0.5 * (1 - t * t * (3 - 2 * t));
    expectRgbClose(bakedAt({ adjust: { shadows: 0.5 } }, 5, [0.25, 0.25, 0.25]), [
      0.25 + lift,
      0.25 + lift,
      0.25 + lift,
    ]);
  });

  it("weights vibrance by how saturated the colour already is", () => {
    // Saturation (max - min) 0.25 gives weight 1 - 0.25 * 0.72; g - b = 0 leaves skin protection off.
    const rgb = [0.5, 0.25, 0.25];
    const luma = rgb.reduce((sum, value, channel) => sum + value * (LUMA[channel] ?? 0), 0);
    const scale = 1 + (1 - 0.25 * 0.72);
    expectRgbClose(
      bakedAt({ adjust: { vibrance: 1 } }, 5, rgb),
      rgb.map((value) => luma + (value - luma) * scale),
    );
  });

  it("mixes the graded colour with the input by intensity", () => {
    expectRgbClose(
      bakedAt({ intensity: 0.5, adjust: { exposure: 1 } }, 5, [0.25, 0.5, 0.75]),
      [0.375, 0.75, 0.875],
    );
  });

  it("applies an RGB curve through the 8-bit curve texture", () => {
    const [r] = bakedAt(
      {
        curves: {
          red: [
            [0, 0],
            [1, 0.5],
          ],
        },
      },
      2,
      [1, 0, 0],
    );
    expect(r).toBeCloseTo(128 / 255, 6);
  });

  it("reads a secondary key as the runtime's float32-staged 8-bit texture does", () => {
    // Luma max 0.9 packs as 229/255, below 0.9, so a 0.9 grey falls outside a hard-edged key.
    const grading: HfColorGrading = {
      secondaries: [
        {
          key: {
            hue: { center: 0, range: 180, softness: 0 },
            saturation: { min: 0, max: 1, softness: 0 },
            luma: { min: 0, max: 0.9, softness: 0 },
          },
          correction: { luma: 0.25 },
        },
      ],
    };
    const lift = 32 / 127;
    expectRgbClose(bakedAt(grading, 11, [0.5, 0.5, 0.5]), [0.5 + lift, 0.5 + lift, 0.5 + lift]);
    expectRgbClose(bakedAt(grading, 11, [0.9, 0.9, 0.9]), [0.9, 0.9, 0.9]);
  });

  it("applies a parsed output LUT at its intensity", () => {
    const invert = parseCubeLut(
      [
        "LUT_3D_SIZE 2",
        "1 1 1",
        "0 1 1",
        "1 0 1",
        "0 0 1",
        "1 1 0",
        "0 1 0",
        "1 0 0",
        "0 0 0",
      ].join("\n"),
    );
    const grading = { lut: { src: "invert.cube", intensity: 0.5 } };
    const rows = bakedRows(bakeHfColorGradingCube(grading, { size: 5, lut: invert }));
    expectRgbClose(rows[(0 * 5 + 2) * 5 + 4] ?? [], [0.5, 0.5, 0.5]);
    expectRgbClose(rows[(4 * 5 + 1) * 5 + 0] ?? [], [0.5, 0.5, 0.5]);
    const full = bakedRows(
      bakeHfColorGradingCube({ lut: "invert.cube" }, { size: 5, lut: invert }),
    );
    expectRgbClose(full[(4 * 5 + 1) * 5 + 0] ?? [], [1, 0.75, 0]);
  });

  it("refuses a grading whose LUT was not passed in", () => {
    expect(() => bakeHfColorGradingCube({ lut: "look.cube" })).toThrow(/look\.cube/);
  });

  it.each([
    ["grain", { details: { grain: 0.3 } }],
    ["vignette", { details: { vignette: 0.4 } }],
    ["blur", { effects: { blur: 0.2 } }],
    ["halftone", { effects: { halftone: 1 } }],
    ["bloom", { effects: { bloom: 0.5 } }],
  ] satisfies [string, HfColorGrading][])("refuses a grading with %s", (name, grading) => {
    expect(() => bakeHfColorGradingCube(grading)).toThrow(new RegExp(name));
  });

  it("refuses a lattice size outside 2..256", () => {
    expect(() => bakeHfColorGradingCube({}, { size: 1 })).toThrow(/size/);
    expect(() => bakeHfColorGradingCube({}, { size: 2.5 })).toThrow(/size/);
  });
});
