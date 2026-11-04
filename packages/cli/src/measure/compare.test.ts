import { describe, expect, it } from "vitest";
import { compareEnergy } from "./energy.js";
import { compareLook, type Look } from "./look.js";

const look = (over: Partial<Look>): Look => ({
  frames: 4,
  luma: 120,
  contrast: 40,
  saturation: 0.4,
  bw_share: 0,
  warmth: 0,
  ...over,
});

describe("compareLook", () => {
  it("finds nothing to compare in grayscale or black against itself", () => {
    const grey = look({ saturation: 0, bw_share: 1 });
    expect(compareLook(grey, grey).saturation_ratio).toBe(1);
    expect(compareLook(grey, look({ saturation: 0.002 })).saturation_ratio).toBe(1);
    const black = look({ luma: 0, contrast: 0, saturation: 0 });
    expect(compareLook(black, black)).toMatchObject({ luma_ratio: 1, contrast_ratio: 1 });
  });

  it("still sees colour or light where the reference has none", () => {
    expect(compareLook(look({ saturation: 0 }), look({})).saturation_ratio).toBeGreaterThan(100);
    expect(compareLook(look({}), look({ saturation: 0 })).saturation_ratio).toBe(0);
    expect(compareLook(look({ luma: 0 }), look({})).luma_ratio).toBeGreaterThan(100);
  });
});

describe("compareEnergy", () => {
  const still = Array.from({ length: 12 }, () => 0);
  const moving = Array.from({ length: 12 }, (_, i) => 2 + (i % 3));

  it("calls two still shots the same amount of movement", () => {
    expect(compareEnergy(still, still)).toMatchObject({ mean_ratio: 1, peak_ratio: 1 });
    expect(
      compareEnergy(
        still,
        still.map(() => 0.02),
      ),
    ).toMatchObject({ mean_ratio: 1 });
  });

  it("still sees movement against a still reference, and the reverse", () => {
    expect(compareEnergy(still, moving).mean_ratio).toBeGreaterThan(100);
    expect(compareEnergy(moving, still).mean_ratio).toBe(0);
  });
});
