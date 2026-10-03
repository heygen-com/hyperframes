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
  it.each([0, 1, 2, 2.5, 3])(
    "shows the tween that starts at the seek time, seeking from %s s",
    (from) => {
      const box = document.body.appendChild(document.createElement("div"));
      const timeline = gsap.timeline({ paused: true });
      timeline.from(box, { x: -60, duration: 2, ease: "none" }, 0);
      timeline.to(box, { keyframes: { "0%": { x: 5 }, "100%": { x: 60 } }, duration: 1 }, 2);
      timeline.totalTime(from, true);
      createGsapAdapter({ getTimeline: () => timeline as unknown as RuntimeTimelineLike }).seek({
        time: 2,
      });
      expect(gsap.getProperty(box, "x")).toBe(5);
    },
  );

  it("leaves a tween that starts later alone after a seek past the end", () => {
    const box = document.body.appendChild(document.createElement("div"));
    const timeline = gsap.timeline({ paused: true });
    timeline.to(box, { x: -400, duration: 0.4 }, 4.8);
    timeline.to(box, { x: 0, duration: 0.4 }, 16);
    const adapter = createGsapAdapter({
      getTimeline: () => timeline as unknown as RuntimeTimelineLike,
    });
    for (const time of [20, 0, 4]) adapter.seek({ time });
    expect(gsap.getProperty(box, "x")).toBe(0);
  });

  it("shows a keyframed tween's start inside a nested timeline, seeking onto it twice", () => {
    const box = document.body.appendChild(document.createElement("div"));
    const timeline = gsap.timeline({ paused: true });
    const scene = gsap.timeline();
    scene.from(box, { x: -60, duration: 2, ease: "none" }, 0);
    scene.to(box, { keyframes: { "0%": { x: 5 }, "100%": { x: 60 } }, duration: 1 }, 2);
    timeline.add(scene, 0.5);
    const adapter = createGsapAdapter({
      getTimeline: () => timeline as unknown as RuntimeTimelineLike,
    });
    adapter.seek({ time: 2.5 });
    adapter.seek({ time: 2.5 });
    expect(gsap.getProperty(box, "x")).toBe(5);
  });

  it("does not start a tween that begins just after the seek time", () => {
    const box = document.body.appendChild(document.createElement("div"));
    const timeline = gsap.timeline({ paused: true });
    timeline.to(box, { x: 100, duration: 10, ease: "none" }, 0);
    timeline.to(box, { x: 200, duration: 1, ease: "none", overwrite: "auto" }, 2.0005);
    const adapter = createGsapAdapter({
      getTimeline: () => timeline as unknown as RuntimeTimelineLike,
    });
    adapter.seek({ time: 2 });
    adapter.seek({ time: 1 });
    expect(gsap.getProperty(box, "x")).toBe(10);
  });

  it("keeps a relative repeatRefresh tween on its iteration at a repeat boundary", () => {
    const box = document.body.appendChild(document.createElement("div"));
    const timeline = gsap.timeline({ paused: true });
    timeline.to(box, { x: "+=10", duration: 1, repeat: 1, repeatRefresh: true, ease: "none" }, 0);
    const adapter = createGsapAdapter({
      getTimeline: () => timeline as unknown as RuntimeTimelineLike,
    });
    adapter.seek({ time: 1 });
    adapter.seek({ time: 1 });
    expect(gsap.getProperty(box, "x")).toBe(10);
  });

  it.each([
    {
      shape: "a stagger whose next target starts 0.1 us later with overwrite auto",
      build: (timeline: gsap.core.Timeline, o: { x: number }) => {
        timeline.to(o, { x: 100, duration: 10, ease: "none" }, 0);
        timeline.to([{ x: 0 }, o], { x: 200, duration: 1, stagger: 1e-7, overwrite: "auto" }, 2);
      },
      seeks: [2, 1],
      x: 10,
    },
    {
      shape: "a reversed keyframed tween",
      build: (timeline: gsap.core.Timeline, o: { x: number }) => {
        const tween = gsap.to(o, { keyframes: { "0%": { x: 5 }, "100%": { x: 60 } }, duration: 1 });
        timeline.add(tween, 1);
        tween.timeScale(-1);
      },
      seeks: [1],
      x: 60,
    },
    {
      shape: "a paused keyframed tween",
      build: (timeline: gsap.core.Timeline, o: { x: number }) => {
        const tween = gsap.to(o, {
          keyframes: { "0%": { x: 5 }, "100%": { x: 60 } },
          duration: 1,
          ease: "none",
        });
        timeline.add(tween, 1);
        tween.totalTime(0.5).pause();
      },
      seeks: [1, 1],
      x: 32.5,
    },
    {
      shape: "a 0.4 us repeatRefresh keyframed tween",
      build: (timeline: gsap.core.Timeline, o: { x: number }) => {
        const keyframes = [
          { x: "+=10", duration: 2e-7 },
          { x: "+=10", duration: 2e-7 },
        ];
        timeline.to(o, { keyframes, repeat: 2, repeatRefresh: true, ease: "none" }, 2);
      },
      seeks: [2, 2],
      x: 0,
    },
  ])("leaves $shape as GSAP renders it at its start", ({ build, seeks, x }) => {
    const o = { x: 0 };
    const timeline = gsap.timeline({ paused: true });
    build(timeline, o);
    const adapter = createGsapAdapter({
      getTimeline: () => timeline as unknown as RuntimeTimelineLike,
    });
    for (const time of seeks) adapter.seek({ time });
    expect(o.x).toBeCloseTo(x, 6);
  });
});
