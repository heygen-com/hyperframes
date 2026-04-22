import { describe, expect, it } from "vitest";
import { resolveSeekPercent } from "./PlayerControls";

describe("resolveSeekPercent", () => {
  it("returns 0 when the track width is invalid", () => {
    expect(resolveSeekPercent(100, 0, 0)).toBe(0);
  });

  it("snaps to the start within the edge threshold", () => {
    expect(resolveSeekPercent(105, 100, 200)).toBe(0);
  });

  it("snaps to the end within the edge threshold", () => {
    expect(resolveSeekPercent(298, 100, 200)).toBe(1);
  });

  it("preserves the true percent away from the edges", () => {
    expect(resolveSeekPercent(150, 100, 200)).toBe(0.25);
  });
});
