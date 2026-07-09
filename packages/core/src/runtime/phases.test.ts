import { describe, expect, it } from "vitest";
import { resolvePhases } from "./phases";

describe("resolvePhases", () => {
  it("keeps authored in/out durations and lets hold absorb slack", () => {
    expect(resolvePhases(8, 1.5, 2)).toEqual({
      in: 1.5,
      hold: 4.5,
      out: 2,
      outAt: 6,
      scale: 1,
    });
  });

  it("compresses in/out uniformly when duration is too short for a hold", () => {
    const phases = resolvePhases(2, 1.5, 2.5);

    expect(phases.scale).toBe(0.5);
    expect(phases.in).toBe(0.75);
    expect(phases.out).toBe(1.25);
    expect(phases.hold).toBe(0);
    expect(phases.in + phases.out).toBe(2);
    expect(phases.outAt).toBe(0.75);
  });

  it("avoids divide-by-zero when both base phase durations are zero", () => {
    expect(resolvePhases(5, 0, 0)).toEqual({
      in: 0,
      hold: 5,
      out: 0,
      outAt: 5,
      scale: 1,
    });
  });

  it("clamps non-positive durations to an all-zero result", () => {
    expect(resolvePhases(0, 1, 1)).toEqual({
      in: 0,
      hold: 0,
      out: 0,
      outAt: 0,
      scale: 0,
    });
    expect(resolvePhases(-2, 1, 1)).toEqual({
      in: 0,
      hold: 0,
      out: 0,
      outAt: 0,
      scale: 0,
    });
  });
});
