import { describe, expect, it } from "vitest";
import { hasFrozenPicture } from "./frozenPicture";
import { mediaSourceTimeAt } from "./media";
import type { RuntimeMediaClip } from "./types";

type Facts = { readyState: number; currentTime: number };

function clip(
  over: Partial<RuntimeMediaClip> = {},
  facts: Facts = { readyState: 4, currentTime: 0 },
) {
  const el = document.createElement("video");
  Object.defineProperty(el, "readyState", { get: () => facts.readyState, configurable: true });
  Object.defineProperty(el, "currentTime", { get: () => facts.currentTime, configurable: true });
  const made: RuntimeMediaClip = {
    el,
    start: 0,
    mediaStart: 0,
    duration: 30,
    end: 30,
    volume: null,
    playbackRate: 1,
    loop: false,
    sourceDuration: 30,
    ...over,
  };
  return { clip: made, facts };
}

/** Plays `seconds` of film in 60 Hz ticks, the video's clock following its clip's timing; counts the frozen ticks. */
function playFollowing(made: ReturnType<typeof clip>, from: number, seconds: number) {
  let frozen = 0;
  for (let t = from; t <= from + seconds; t += 1 / 60) {
    made.facts.currentTime = mediaSourceTimeAt(made.clip, t);
    if (hasFrozenPicture([made.clip], t)) frozen += 1;
  }
  return frozen;
}

describe("hasFrozenPicture", () => {
  it("is false while a video's clock follows its clip's timing and it has a frame", () => {
    expect(playFollowing(clip(), 0, 4)).toBe(0);
  });

  it("is true for a video with no frame to show, though it is paused", () => {
    const v = clip({}, { readyState: 0, currentTime: 0 });
    expect(hasFrozenPicture([v.clip], 0)).toBe(true);
  });

  it("is true once a video's clock stands still for a second of film, and false again when it moves", () => {
    const v = clip({}, { readyState: 4, currentTime: 2 });
    hasFrozenPicture([v.clip], 10);
    expect(hasFrozenPicture([v.clip], 10.5)).toBe(false);
    expect(hasFrozenPicture([v.clip], 11.2)).toBe(true);
    v.facts.currentTime = 3.2;
    expect(hasFrozenPicture([v.clip], 12.3)).toBe(false);
  });

  it("never reads a looping clip's wrap as a stall", () => {
    expect(playFollowing(clip({ loop: true, sourceDuration: 3 }), 0, 12)).toBe(0);
  });

  it("never reads a clip at the slowest rate as a stall", () => {
    expect(playFollowing(clip({ playbackRate: 0.1 }), 0, 12)).toBe(0);
  });

  it("does not count a clip holding its last frame", () => {
    expect(playFollowing(clip({ sourceDuration: 2, end: 30 }), 0, 8)).toBe(0);
  });
});
