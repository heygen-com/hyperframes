// @vitest-environment happy-dom
import gsap from "gsap";
import { describe, expect, it } from "vitest";
import { createGsapAdapter } from "./gsap";
import type { RuntimeTimelineLike } from "../types";

// Every 0.1 s: hide all three frames, then show one, as frame-by-frame films do.
function steppedFilm() {
  const frames = [0, 1, 2].map(() => document.body.appendChild(document.createElement("div")));
  let calls = 0;
  const timeline = gsap.timeline({ paused: true });
  for (let k = 0; k < 30; k++) {
    timeline.set(frames, { visibility: "hidden" }, k * 0.1);
    timeline.set(frames[k % 3]!, { visibility: "visible" }, k * 0.1);
  }
  timeline.call(() => void calls++, [], 2.5);
  const adapter = createGsapAdapter({
    getTimeline: () => timeline as unknown as RuntimeTimelineLike,
  });
  const shown = () => frames.map((frame) => frame.style.visibility === "visible");
  return { timeline, adapter, shown, calls: () => calls };
}

describe("gsap adapter on a step", () => {
  it.each([0, 1, 2.7])("shows the step's frame when seeking onto it from %s s", (from) => {
    const film = steppedFilm();
    film.timeline.totalTime(from, true);
    film.adapter.seek({ time: 2.5 });
    expect(film.shown()).toEqual([false, true, false]);
  });

  it("fires a call on the step once when seeking onto it twice", () => {
    const film = steppedFilm();
    film.adapter.seek({ time: 2.5 });
    film.adapter.seek({ time: 2.5 });
    expect(film.calls()).toBe(1);
  });

  it("applies a set at 0 on a timeline that has not moved yet", () => {
    const intro = document.body.appendChild(document.createElement("div"));
    const timeline = gsap.timeline({ paused: true });
    timeline.set(intro, { display: "block" }, 0).to(intro, { opacity: 0, duration: 1 }, 1);
    intro.style.display = "none";
    createGsapAdapter({ getTimeline: () => timeline as unknown as RuntimeTimelineLike }).seek({
      time: 0,
    });
    expect(intro.style.display).toBe("block");
  });

  it("restores a value changed outside the timeline when seeking 0 again", () => {
    const box = document.body.appendChild(document.createElement("div"));
    const timeline = gsap.timeline({ paused: true });
    timeline.fromTo(box, { x: 10 }, { x: 100, duration: 1 }, 0);
    const adapter = createGsapAdapter({
      getTimeline: () => timeline as unknown as RuntimeTimelineLike,
    });
    adapter.seek({ time: 0 });
    gsap.set(box, { x: 999 });
    adapter.seek({ time: 0 });
    expect(gsap.getProperty(box, "x")).toBe(10);
  });
});

describe("gsap adapter at a tween's start", () => {
  // An edit at 2 s turns the later tween into keyframes; its first keyframe must win over the from() end.
  it.each([0, 1, 2.5, 3])("shows the tween that starts at the seek time, seeking from %s s", (from) => {
    const box = document.body.appendChild(document.createElement("div"));
    const timeline = gsap.timeline({ paused: true });
    timeline.from(box, { x: -60, duration: 2, ease: "none" }, 0);
    timeline.to(box, { keyframes: { "0%": { x: 5 }, "100%": { x: 60 } }, duration: 1 }, 2);
    timeline.totalTime(from, true);
    createGsapAdapter({ getTimeline: () => timeline as unknown as RuntimeTimelineLike }).seek({ time: 2 });
    expect(gsap.getProperty(box, "x")).toBe(5);
  });
});
