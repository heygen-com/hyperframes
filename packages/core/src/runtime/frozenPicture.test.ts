import { describe, expect, it } from "vitest";
import { hasFrozenPicture } from "./frozenPicture";

function video(state: { readyState: number; currentTime: number; ended?: boolean }) {
  const el = document.createElement("video");
  for (const key of ["readyState", "currentTime", "ended"] as const)
    Object.defineProperty(el, key, { get: () => state[key] ?? false, configurable: true });
  return { el, state };
}

describe("hasFrozenPicture", () => {
  it("is false while every video's clock follows the film's and each has a frame", () => {
    const v = video({ readyState: 4, currentTime: 0 });
    expect(hasFrozenPicture([v.el], 0, 1)).toBe(false);
    for (let t = 0.5; t <= 4; t += 0.5) {
      v.state.currentTime = t;
      expect(hasFrozenPicture([v.el], t, 1)).toBe(false);
    }
  });

  it("is true for a video with no frame to show, though it is paused", () => {
    const v = video({ readyState: 0, currentTime: 0 });
    expect(hasFrozenPicture([v.el], 0, 1)).toBe(true);
  });

  it("is true once a video's clock stands still for a second of film, and false again when it moves", () => {
    const v = video({ readyState: 4, currentTime: 2 });
    hasFrozenPicture([v.el], 10, 1);
    expect(hasFrozenPicture([v.el], 10.5, 1)).toBe(false);
    expect(hasFrozenPicture([v.el], 11.2, 1)).toBe(true);
    v.state.currentTime = 3.2;
    expect(hasFrozenPicture([v.el], 12.3, 1)).toBe(false);
  });

  it("does not count a slowed clip or a clip that ended", () => {
    const slow = video({ readyState: 4, currentTime: 0 });
    hasFrozenPicture([slow.el], 0, 1);
    slow.state.currentTime = 0.4;
    expect(hasFrozenPicture([slow.el], 1.2, 1)).toBe(false);
    const done = video({ readyState: 4, currentTime: 5, ended: true });
    hasFrozenPicture([done.el], 0, 1);
    expect(hasFrozenPicture([done.el], 1.5, 1)).toBe(false);
  });
});
