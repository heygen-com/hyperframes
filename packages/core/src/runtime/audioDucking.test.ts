import { describe, expect, it } from "vitest";
import {
  duck,
  type DuckTimelineLike,
  type DuckTrack,
  type DuckTrackTiming,
} from "./audioDucking.js";
import { interpolateVolumeGain, normaliseEnvelope } from "./mediaVolumeEnvelope.js";

interface TimelineOp {
  kind: "set" | "to";
  target: DuckTrack;
  at: number | undefined;
  volume: number;
  duration?: number;
  ease?: "none";
  overwrite?: false;
}

function recordingTimeline(ops: TimelineOp[]): DuckTimelineLike {
  return {
    set(target, vars, at) {
      ops.push({ kind: "set", target, at, volume: vars.volume });
    },
    to(target, vars, at) {
      ops.push({
        kind: "to",
        target,
        at,
        volume: vars.volume,
        duration: vars.duration,
        ease: vars.ease,
        overwrite: vars.overwrite,
      });
    },
  };
}

function audioTrack(start: number, duration: number, volume = 1): DuckTrackTiming {
  return { start, duration, volume };
}

function requireOp(ops: TimelineOp[], index: number): TimelineOp {
  const op = ops[index];
  expect(op).toBeDefined();
  if (!op) throw new Error(`Missing timeline op ${index}`);
  return op;
}

describe("duck", () => {
  it("generates volume ramps around voice overlaps", () => {
    const keyframes = duck(audioTrack(0, 8, 0.8), audioTrack(2, 2), {
      amount: "-12dB",
      fade: 0.5,
    });

    expect(keyframes.map((kf) => kf.time)).toEqual([1.5, 2, 4, 4.5]);
    expect(keyframes[0]?.volume).toBe(0.8);
    expect(keyframes[1]?.volume).toBeCloseTo(0.20095, 5);
    expect(keyframes[2]?.volume).toBeCloseTo(0.20095, 5);
    expect(keyframes[3]?.volume).toBe(0.8);
  });

  it("writes generated ramps to a timeline", () => {
    const music = audioTrack(0, 8, 0.8);
    const voice = audioTrack(2, 2);
    const ops: TimelineOp[] = [];

    duck(music, voice, {
      timeline: recordingTimeline(ops),
      amount: "-12dB",
      fade: 0.5,
    });

    expect(ops).toHaveLength(4);
    expect(requireOp(ops, 0)).toMatchObject({ kind: "set", target: music, at: 1.5, volume: 0.8 });
    expect(requireOp(ops, 1)).toMatchObject({
      kind: "to",
      target: music,
      at: 1.5,
      duration: 0.5,
      ease: "none",
      overwrite: false,
    });
    expect(requireOp(ops, 1).volume).toBeCloseTo(0.20095, 5);
    expect(requireOp(ops, 2)).toMatchObject({ kind: "to", target: music, at: 2, duration: 2 });
    expect(requireOp(ops, 3)).toMatchObject({
      kind: "to",
      target: music,
      at: 4,
      duration: 0.5,
      volume: 0.8,
    });
  });

  it("merges voice gaps shorter than two fades", () => {
    const keyframes = duck(audioTrack(0, 5), [audioTrack(1, 1), audioTrack(2.3, 0.7)], {
      amount: 0.25,
      fade: 0.25,
    });

    expect(keyframes).toEqual([
      { time: 0.75, volume: 1 },
      { time: 1, volume: 0.25 },
      { time: 3, volume: 0.25 },
      { time: 3.25, volume: 1 },
    ]);
  });

  it("uses resolved timeline duration for voice clips", () => {
    const keyframes = duck(audioTrack(0, 8), audioTrack(1, 6), {
      amount: 0.5,
      fade: 0.5,
    });

    expect(keyframes).toEqual([
      { time: 0.5, volume: 1 },
      { time: 1, volume: 0.5 },
      { time: 7, volume: 0.5 },
      { time: 7.5, volume: 1 },
    ]);
  });

  it("produces keyframes compatible with the shared volume envelope", () => {
    const keyframes = duck(audioTrack(0, 4), audioTrack(1, 1), {
      amount: "-12dB",
      fade: 0.25,
    });
    const envelope = normaliseEnvelope(keyframes, 0, 1);

    expect(interpolateVolumeGain(envelope, 0.5)).toBe(1);
    expect(interpolateVolumeGain(envelope, 1.5)).toBeCloseTo(0.251189, 5);
    expect(interpolateVolumeGain(envelope, 2.5)).toBe(1);
  });

  it("reads timed media elements without writing schema attributes", () => {
    const music = document.createElement("audio");
    music.id = "music";
    music.dataset.start = "0";
    music.dataset.duration = "4";
    music.dataset.volume = "0.6";

    const voice = document.createElement("audio");
    voice.id = "voice";
    voice.dataset.start = "1";
    voice.dataset.duration = "1";

    const keyframes = duck(music, [voice], { amount: 0.5, fade: 0.25 });

    expect(keyframes).toEqual([
      { time: 0.75, volume: 0.6 },
      { time: 1, volume: 0.3 },
      { time: 2, volume: 0.3 },
      { time: 2.25, volume: 0.6 },
    ]);
    expect(music.hasAttribute("data-duck")).toBe(false);
    expect(music.hasAttribute("data-duck-fade")).toBe(false);
    expect(music.hasAttribute("data-role")).toBe(false);
    expect(music.getAttributeNames().some((name) => name.startsWith("data-hf-duck"))).toBe(false);
  });
});
