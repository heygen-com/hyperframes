import { describe, expect, it, vi } from "vitest";
import { limitDeliveryPeaks } from "./audioDeliveryLimit.js";

const INPUT = {
  audioPath: "/w/audio.m4a",
  sourcePath: "/w/audio-source.wav",
  targetDurationSeconds: 8,
  timeoutMs: 1000,
};
const LIMITED = ["/w/audio-source-limited-a.wav", "/w/audio-source-limited-b.wav"];

/** `peaks`: what each measure reads in turn, the first encode's then each limited encode's; the last one repeats. */
function deps(...peaks: number[]) {
  let read = 0;
  return {
    measure: vi.fn(async () => peaks[Math.min(read++, peaks.length - 1)]!),
    applyChain: vi.fn(async () => ({ path: LIMITED[0]!, envelopeBaked: false })),
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

  const ceilings = (d: ReturnType<typeof deps>) =>
    d.applyChain.mock.calls.map(
      ([, chain]) =>
        (chain as { nodes: { params: { ceiling: number } }[] }).nodes[0]!.params.ceiling,
    );

  it("limits a mix over the ceiling at the ceiling itself when its encode lands under", async () => {
    const d = deps(2.4, -1.1);
    await limitDeliveryPeaks(INPUT, d as unknown as Deps);
    expect(ceilings(d)).toEqual([-1]);
    expect(d.applyChain).toHaveBeenCalledWith(
      INPUT.sourcePath,
      expect.anything(),
      LIMITED[0],
      expect.anything(),
    );
    expect(d.encode).toHaveBeenCalledWith(LIMITED[0], INPUT.audioPath, 8, expect.anything());
    // The whole-mix cut behind this measures against the limited mix, not the original.
    expect(d.rename).toHaveBeenCalledWith(LIMITED[0], INPUT.sourcePath, { copyFallback: true });
  });

  it("lowers the ceiling by what each encode measured over, from the original mix, never past -3", async () => {
    const d = deps(2.4, -0.4, -0.9, 0.5);
    await limitDeliveryPeaks(INPUT, d as unknown as Deps);
    expect(ceilings(d).map((c) => Number(c.toFixed(2)))).toEqual([-1, -1.65, -1.8]);
    expect(d.applyChain.mock.calls.every(([from]) => from === INPUT.sourcePath)).toBe(true);
    expect(d.rename).toHaveBeenCalledWith(LIMITED[0], INPUT.sourcePath, { copyFallback: true });

    const deep = deps(2.4, 3, 3);
    await limitDeliveryPeaks(INPUT, deep as unknown as Deps);
    expect(ceilings(deep)).toEqual([-1, -3]);
  });

  it("keeps the last good pass when a later limit cannot run", async () => {
    const d = deps(2.4, -0.5);
    d.applyChain.mockResolvedValueOnce({ path: LIMITED[0]!, envelopeBaked: false });
    d.applyChain.mockRejectedValueOnce(new Error("browser gone"));
    await limitDeliveryPeaks(INPUT, d as unknown as Deps);
    expect(d.encode).toHaveBeenCalledTimes(1);
    expect(d.rename).toHaveBeenCalledWith(LIMITED[0], INPUT.sourcePath, { copyFallback: true });
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
