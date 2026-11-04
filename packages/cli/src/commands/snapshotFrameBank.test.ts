import { describe, expect, it, vi } from "vitest";
import {
  createFrameBank,
  groupOverlappingDecodes,
  type FrameWant,
  type PlannedFrame,
  type SeekPlan,
} from "./snapshotFrameBank.js";

const want = (time: number): FrameWant => ({ time, displayedPixels: 1080, holdLastFrame: false });
const planned = (decodesFrom: number, mid: number): PlannedFrame => ({
  ...want(mid),
  seek: decodesFrom,
  select: mid - decodesFrom,
  decodesFrom,
});

/** A source whose only keyframe is at 0: every frame decodes from there. */
const singleKeyframe = async (_path: string, time: number): Promise<SeekPlan> => ({
  seek: Math.max(0, time - 0.1),
  select: 0.1,
  decodesFrom: 0,
});

describe("groupOverlappingDecodes", () => {
  it("puts frames that decode from the same keyframe in one pass", () => {
    const groups = groupOverlappingDecodes([planned(0, 100), planned(0, 40), planned(0, 150)]);
    expect(groups.map((group) => group.length)).toEqual([3]);
  });

  it("keeps frames with separate keyframes apart", () => {
    const groups = groupOverlappingDecodes([planned(0, 1), planned(10, 11), planned(20, 21)]);
    expect(groups.map((group) => group.length)).toEqual([1, 1, 1]);
  });

  it("chains runs that touch end to end", () => {
    const groups = groupOverlappingDecodes([planned(0, 5), planned(4, 9), planned(30, 31)]);
    expect(groups.map((group) => group.length)).toEqual([2, 1]);
  });
});

describe("createFrameBank", () => {
  const decoded = (frames: PlannedFrame[]) =>
    frames.map((frame) => Buffer.from(String(frame.time)));

  it("decodes every time of a one-keyframe source in a single pass", async () => {
    const decode = vi.fn(async (_path: string, frames: PlannedFrame[]) => decoded(frames));
    const bank = createFrameBank({ probe: singleKeyframe, decode });
    const times = [105, 115, 125, 135, 145, 155];
    await bank.plan("rec.mp4", times.map(want));
    expect(decode, "nothing decodes until a frame is asked for").not.toHaveBeenCalled();
    for (const time of times) {
      expect((await bank.take("rec.mp4", want(time)))?.toString()).toBe(String(time));
    }
    expect(decode).toHaveBeenCalledTimes(1);
    expect(decode.mock.calls[0]![1].map((frame) => frame.time).sort()).toEqual(times.sort());
    expect(bank.stats).toMatchObject({ passes: 1, frames: 6, sharedFrames: 6 });
    expect(bank.stats.longestDecodeSeconds).toBeCloseTo(155, 3);
  });

  it("decodes frames near their own keyframes separately", async () => {
    const decode = vi.fn(async (_path: string, frames: PlannedFrame[]) => decoded(frames));
    const bank = createFrameBank({
      probe: async (_path, time) => ({
        seek: Math.floor(time),
        select: 0.4,
        decodesFrom: Math.floor(time),
      }),
      decode,
    });
    await bank.plan("clip.mp4", [want(1.2), want(5.2), want(9.2)]);
    await Promise.all([1.2, 5.2, 9.2].map((time) => bank.take("clip.mp4", want(time))));
    expect(decode).toHaveBeenCalledTimes(3);
    expect(bank.stats.sharedFrames).toBe(0);
  });

  it("hands back nothing for a frame it did not plan", async () => {
    const bank = createFrameBank({ probe: singleKeyframe, decode: async (_p, f) => decoded(f) });
    await bank.plan("rec.mp4", [want(10)]);
    expect(bank.take("rec.mp4", want(11))).toBeUndefined();
    expect(bank.take("other.mp4", want(10))).toBeUndefined();
  });

  it("leaves a frame to the single-frame path when its landing is unknown", async () => {
    const decode = vi.fn(async (_p: string, f: PlannedFrame[]) => decoded(f));
    const bank = createFrameBank({ probe: async () => ({ select: 1 }), decode });
    await bank.plan("rec.mp4", [want(10)]);
    expect(decode).not.toHaveBeenCalled();
    expect(bank.take("rec.mp4", want(10))).toBeUndefined();
  });

  it("leaves every frame to the single-frame path when a probe fails", async () => {
    const decode = vi.fn(async (_p: string, f: PlannedFrame[]) => decoded(f));
    const bank = createFrameBank({
      probe: async () => {
        throw new Error("ffprobe could not read it");
      },
      decode,
    });
    await bank.plan("rec.mp4", [want(10), want(20)]);
    expect(decode).not.toHaveBeenCalled();
    expect(bank.take("rec.mp4", want(10))).toBeUndefined();
  });

  it("hands back nothing for the frames of a pass that failed, so each decodes alone", async () => {
    const bank = createFrameBank({
      probe: singleKeyframe,
      decode: async () => {
        throw new Error("FFmpeg timed out");
      },
    });
    await bank.plan("rec.mp4", [want(10), want(20)]);
    expect(await bank.take("rec.mp4", want(10))).toBeUndefined();
    expect(await bank.take("rec.mp4", want(20))).toBeUndefined();
  });

  it("decodes frames of different displayed sizes in separate passes", async () => {
    const decode = vi.fn(async (_p: string, f: PlannedFrame[]) => decoded(f));
    const bank = createFrameBank({ probe: singleKeyframe, decode });
    const small = { ...want(40), displayedPixels: 540 };
    await bank.plan("rec.mp4", [want(30), small, want(50)]);
    await Promise.all([want(30), small, want(50)].map((frame) => bank.take("rec.mp4", frame)));
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it("serves a time asked for twice from one decoded frame", async () => {
    const decode = vi.fn(async (_p: string, f: PlannedFrame[]) => decoded(f));
    const bank = createFrameBank({ probe: singleKeyframe, decode });
    await bank.plan("rec.mp4", [want(30), want(30), want(40)]);
    expect(await bank.take("rec.mp4", want(30))).toBeDefined();
    expect(decode.mock.calls[0]![1]).toHaveLength(2);
    expect(await bank.take("rec.mp4", want(30))).toBeDefined();
    expect(bank.take("rec.mp4", want(30))).toBeUndefined();
  });
});
