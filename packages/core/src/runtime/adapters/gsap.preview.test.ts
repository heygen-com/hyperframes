import gsap from "gsap";
import { describe, expect, it } from "vitest";
import { seekGsapTimeline } from "./gsap";
import type { RuntimeTimelineLike } from "../types";

// A lyric word's 0.16 s pop-in still running when the hide for the next word fires 0.01 s before it ends.
function popThenHide() {
  const word = { opacity: 0 };
  const timeline = gsap.timeline({ paused: true });
  timeline.fromTo(word, { opacity: 0 }, { opacity: 1, duration: 0.16, ease: "expo.out" }, 0.54);
  timeline.set(word, { opacity: 0 }, 0.69);
  return { word, timeline: timeline as unknown as RuntimeTimelineLike };
}

/** The word's opacity after a preview that plays on ticks of `dt`, the first landing `phase` into the film. */
function played(dt: number, phase: number, until = 0.9): number {
  const { word, timeline } = popThenHide();
  const structure = { owner: timeline, version: "1" };
  for (let t = phase; t < until; t += dt) seekGsapTimeline(timeline, t, false, structure);
  seekGsapTimeline(timeline, until, false, structure);
  return word.opacity;
}

/** The same word after one seek, which renders everything before it in start order. */
function seeked(from: number, until = 0.9): number {
  const { word, timeline } = popThenHide();
  seekGsapTimeline(timeline, from, true);
  seekGsapTimeline(timeline, until, true);
  return word.opacity;
}

describe("a preview that plays a pop-in the next word's hide interrupts", () => {
  it("hides the word after the hide, as a seek does, whichever tick lands between the hide and the pop-in's end", () => {
    expect(seeked(0)).toBe(0);
    expect(seeked(5)).toBe(0);
    for (const hz of [30, 60, 144]) {
      for (let k = 0; k < 24; k++) {
        const dt = 1 / hz;
        expect([hz, k, played(dt, (k / 24) * dt)]).toEqual([hz, k, 0]);
      }
    }
  });

  it("still lets the pop-in run to its end where nothing interrupts it", () => {
    const word = { opacity: 0 };
    const timeline = gsap.timeline({ paused: true });
    timeline.fromTo(word, { opacity: 0 }, { opacity: 1, duration: 0.16 }, 0.54);
    const structure = { owner: timeline, version: "1" };
    for (let t = 0; t < 0.9; t += 1 / 60) seekGsapTimeline(timeline as never, t, false, structure);
    expect(word.opacity).toBe(1);
  });
});
