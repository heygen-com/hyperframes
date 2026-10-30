import { describe, expect, it } from "vitest";
import { compareLook, sameLook, type Look } from "./look.js";

const look = (saturation: number): Look =>
  ({
    frames: 10,
    luma: 120,
    contrast: 40,
    saturation,
    bw_share: saturation ? 0 : 1,
    warmth: 0,
  }) as Look;

describe("compareLook", () => {
  it("calls two black-and-white clips the same and a grey one against colour different", () => {
    expect(compareLook(look(0), look(0)).saturation_ratio).toBe(1);
    expect(sameLook(compareLook(look(0), look(0)))).toBe(true);
    expect(sameLook(compareLook(look(0.3), look(0)))).toBe(false);
    expect(sameLook(compareLook(look(0), look(0.3)))).toBe(false);
  });
});
