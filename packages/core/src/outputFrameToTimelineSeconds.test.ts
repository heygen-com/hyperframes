import { describe, it, expect } from "vitest";
import { outputFrameToTimelineSeconds } from "./core.types.js";

describe("outputFrameToTimelineSeconds", () => {
  const fps = { num: 30, den: 1 };

  it("no-op when renderStretch is omitted (defaults to 1)", () => {
    for (const i of [0, 1, 29, 143]) {
      expect(outputFrameToTimelineSeconds(i, fps)).toBe((i * fps.den) / fps.num);
    }
  });

  it("renderStretch=1 is byte-identical to the raw frame time", () => {
    expect(outputFrameToTimelineSeconds(143, fps, 1)).toBe(143 / 30);
  });

  it("stretches a 1s comp across a 4.8s output (renderStretch = intrinsic/target)", () => {
    const rs = 1 / 4.8;
    expect(outputFrameToTimelineSeconds(0, fps, rs)).toBe(0);
    // last of 144 output frames lands just under intrinsic 1.0s — never past it
    const last = outputFrameToTimelineSeconds(143, fps, rs);
    expect(last).toBeGreaterThan(0.98);
    expect(last).toBeLessThan(1.0);
  });

  it("honors an exact rational fps (NTSC 30000/1001)", () => {
    const ntsc = { num: 30000, den: 1001 };
    expect(outputFrameToTimelineSeconds(30, ntsc, 1)).toBe((30 * 1001) / 30000);
  });
});
