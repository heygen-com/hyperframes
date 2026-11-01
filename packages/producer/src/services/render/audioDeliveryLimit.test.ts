import { describe, expect, it, vi } from "vitest";
import { limitDeliveryPeaks } from "./audioDeliveryLimit.js";

const INPUT = {
  audioPath: "/w/audio.m4a",
  sourcePath: "/w/audio-source.wav",
  targetDurationSeconds: 8,
  timeoutMs: 1000,
};
const LIMITED = "/w/audio-source-limited.wav";

function deps(peak: number) {
  return {
    measure: vi.fn(async () => peak),
    applyChain: vi.fn(async () => ({ path: LIMITED, envelopeBaked: false })),
    encode: vi.fn(async () => ({ success: true })),
    rename: vi.fn(),
    sourceExists: vi.fn(() => true),
  };
}
type Deps = NonNullable<Parameters<typeof limitDeliveryPeaks>[1]>;

describe("limitDeliveryPeaks", () => {
  it("leaves a mix under the ceiling alone, with no browser and no encode", async () => {
    const d = deps(-1);
    await expect(limitDeliveryPeaks(INPUT, d as unknown as Deps)).resolves.toEqual({
      success: true,
    });
    expect(d.applyChain).not.toHaveBeenCalled();
    expect(d.encode).not.toHaveBeenCalled();
  });

  it("re-encodes a mix over the ceiling through a true-peak limit 2 dB under it", async () => {
    const d = deps(2.4);
    await limitDeliveryPeaks(INPUT, d as unknown as Deps);
    expect(d.applyChain).toHaveBeenCalledWith(
      INPUT.sourcePath,
      {
        version: 1,
        nodes: [{ type: "truepeak", id: "delivery", params: { ceiling: -3 } }],
      },
      LIMITED,
      expect.anything(),
    );
    expect(d.encode).toHaveBeenCalledWith(LIMITED, INPUT.audioPath, 8, expect.anything());
    // The whole-mix cut behind this measures against the limited mix, not the original.
    expect(d.rename).toHaveBeenCalledWith(LIMITED, INPUT.sourcePath, { copyFallback: true });
  });

  it("leaves the first encode for the whole-mix cut when the limit cannot run, and says so", async () => {
    const d = deps(2.4);
    d.applyChain.mockRejectedValueOnce(new Error("no browser"));
    const warn = vi.fn();
    await expect(limitDeliveryPeaks({ ...INPUT, warn }, d as unknown as Deps)).resolves.toEqual({
      success: true,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("whole-mix"), {
      error: "no browser",
    });
    expect(d.encode).not.toHaveBeenCalled();
  });

  it("fails the render when the limited mix cannot be encoded", async () => {
    const d = deps(2.4);
    d.encode.mockResolvedValueOnce({
      success: false,
      exitCode: 1,
      stderr: "encoder died",
      terminationReason: "exit",
    } as never);
    const result = await limitDeliveryPeaks(INPUT, d as unknown as Deps);
    expect(result.success).toBe(false);
    expect(result.error).toContain("audioDeliveryLimit");
    expect(d.rename).not.toHaveBeenCalled();
  });

  it("does nothing when the mix left no source to limit", async () => {
    const d = deps(2.4);
    d.sourceExists.mockReturnValueOnce(false);
    await limitDeliveryPeaks(INPUT, d as unknown as Deps);
    expect(d.measure).not.toHaveBeenCalled();
  });
});
