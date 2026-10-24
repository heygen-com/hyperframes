import { describe, expect, it } from "vitest";
import { compareEnergy } from "./energy.js";

describe("compareEnergy", () => {
  it("still compares amounts on a window too short to correlate", () => {
    const e = compareEnergy([1, 2, 3, 2, 1, 2], [0.5, 1, 1.5, 1, 0.5, 1]);
    expect(e.r).toBeNull();
    expect(e.mean_ratio).toBe(0.5);
  });

  it("calls two still clips the same amount of motion and a still one against a moving one different", () => {
    const still = new Array(20).fill(0);
    const moving = Array.from({ length: 20 }, (_, i) => 2 + (i % 3));
    expect(compareEnergy(still, still).mean_ratio).toBe(1);
    expect(compareEnergy(moving, still).mean_ratio).toBe(0);
    expect(compareEnergy(still, moving).mean_ratio).toBeGreaterThan(1.25);
  });
});
