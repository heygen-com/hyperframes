// @vitest-environment happy-dom
import gsap from "gsap";
import { describe, expect, it } from "vitest";
import { createGsapAdapter, rerenderGsapTimelineAt } from "./gsap";
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
  // Issue #5122: a render seeks every frame in order; only the from-vars set transformOrigin.
  it("keeps a fromTo's from-only values from the frame it starts on, with immediateRender off", () => {
    const box = document.body.appendChild(document.createElement("div"));
    const timeline = gsap.timeline({ paused: true });
    timeline.fromTo(
      box,
      { scale: 1.5, transformOrigin: "0% 0%" },
      { scale: 1, duration: 0.45, ease: "none", immediateRender: false },
      0.1,
    );
    timeline.set({}, {}, 1);
    const adapter = createGsapAdapter({
      getTimeline: () => timeline as unknown as RuntimeTimelineLike,
    });
    const origins = [2, 3, 4, 5].map((frame) => {
      adapter.seek({ time: frame / 30 });
      return box.style.transformOrigin;
    });
    expect(origins).toEqual(["", "0% 0%", "0% 0%", "0% 0%"]);
    expect(gsap.getProperty(box, "scaleX")).toBeCloseTo(1.4259, 3);
  });

  it("keeps a keyframed fromTo's from-only values over an earlier tween's on the same element", () => {
    const box = document.body.appendChild(document.createElement("div"));
    const timeline = gsap.timeline({ paused: true });
    const fromTo = (origin: string, to: gsap.TweenVars, at: number) =>
      timeline.fromTo(
        box,
        { scale: 1.5, transformOrigin: origin },
        { scale: 1, immediateRender: false, ...to },
        at,
      );
    fromTo("0% 0%", { duration: 0.1 }, 0);
    fromTo("100% 100%", { duration: 0.1 }, 0.1);
    fromTo("0% 0%", { keyframes: { y: [0, 40] }, duration: 0.5 }, 0.2);
    timeline.set({}, {}, 1);
    const adapter = createGsapAdapter({
      getTimeline: () => timeline as unknown as RuntimeTimelineLike,
    });
    const origins = [0, 2 / 30, 0.1, 4 / 30, 0.2, 7 / 30].map((time) => {
      adapter.seek({ time });
      return box.style.transformOrigin;
    });
    expect(origins.slice(1)).toEqual(["0% 0%", "100% 100%", "100% 100%", "0% 0%", "0% 0%"]);
  });

  it("still lets a set authored later on the tween's start win over its from-values", () => {
    const box = document.body.appendChild(document.createElement("div"));
    const timeline = gsap.timeline({ paused: true });
    timeline.fromTo(
      box,
      { opacity: 0, transformOrigin: "0% 0%" },
      { opacity: 1, duration: 0.5, immediateRender: false },
      0.1,
    );
    timeline.set(box, { opacity: 0.3, transformOrigin: "100% 100%" }, 0.1);
    timeline.set({}, {}, 1);
    createGsapAdapter({ getTimeline: () => timeline as unknown as RuntimeTimelineLike }).seek({
      time: 0.1,
    });
    expect([box.style.opacity, box.style.transformOrigin]).toEqual(["0.3", "100% 100%"]);
  });

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

  it.each([
    { order: "keyframes, then a set", x: 42 },
    { order: "a set, then keyframes", x: 5 },
  ])("keeps the authored order of $order at the seek time", ({ order, x }) => {
    const box = document.body.appendChild(document.createElement("div"));
    const timeline = gsap.timeline({ paused: true });
    timeline.from(box, { x: -60, duration: 2, ease: "none" }, 0);
    const keyframes = () =>
      timeline.to(box, { keyframes: { "0%": { x: 5 }, "100%": { x: 60 } }, duration: 1 }, 2);
    const set = () => timeline.set(box, { x: 42 }, 2);
    if (order.startsWith("keyframes")) {
      keyframes();
      set();
    } else {
      set();
      keyframes();
    }
    const adapter = createGsapAdapter({
      getTimeline: () => timeline as unknown as RuntimeTimelineLike,
    });
    for (const from of [0, 1, 2, 2.5, 3]) {
      timeline.totalTime(from, true);
      adapter.seek({ time: 2 });
      expect(gsap.getProperty(box, "x")).toBe(x);
    }
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

describe("re-rendering onto a call at the playhead", () => {
  type Film = {
    build: (timeline: gsap.core.Timeline, fire: () => void) => void;
    at: number;
    to: number;
  };
  const nestedAt = (callAt: number, repeat = 0, speed = 1): Film["build"] => {
    return (timeline, fire) => {
      const scene = gsap.timeline({ repeat }).to({ y: 0 }, { y: 1, duration: 4 });
      scene.call(fire, [], callAt).timeScale(speed);
      timeline.add(scene, 1);
    };
  };
  const films: Record<string, Film> = {
    "a call on the playhead": { build: (tl, fire) => void tl.call(fire, [], 2), at: 2, to: 3 },
    "a call at 0 on a fresh timeline": {
      build: (tl, fire) => void tl.call(fire, [], 0),
      at: 0,
      to: 1,
    },
    "a reversed call": {
      build: (tl, fire) => void tl.call(fire, [], 2).getChildren().at(-1)!.reversed(true),
      at: 2,
      to: 3,
    },
    "a call in a nested timeline": { build: nestedAt(1), at: 2, to: 3 },
    "a call in a repeating nested timeline": { build: nestedAt(2, 1), at: 7, to: 8 },
    "a call in a nested timeline at double speed": { build: nestedAt(1, 0, 2), at: 1.5, to: 2 },
    "a call in an otherwise empty nested timeline": {
      build: (tl, fire) => void tl.add(gsap.timeline().call(fire), 2),
      at: 2,
      to: 3,
    },
  };

  it.each(Object.keys(films).flatMap((film) => [false, true].map((silent) => ({ film, silent }))))(
    "fires $film as often as without the redraw (arrived silently: $silent)",
    ({ film, silent }) => {
      const { build, at, to } = films[film]!;
      const fires = (redraw: boolean, arriveSilently = silent) => {
        let fired = 0;
        const timeline = gsap.timeline({ paused: true }).to({ x: 0 }, { x: 1, duration: 10 });
        build(timeline, () => void fired++);
        timeline.totalTime(at, arriveSilently);
        if (redraw) rerenderGsapTimelineAt(timeline, at);
        timeline.totalTime(to, false);
        return fired;
      };
      // GSAP itself never fires a call in an otherwise empty nested timeline arrived at silently.
      expect(fires(false, false)).toBeGreaterThan(0);
      expect(fires(true)).toBe(fires(false));
    },
  );
});

describe("re-rendering leaves the rest as the seek left it", () => {
  const shapes: Record<string, (timeline: gsap.core.Timeline, o: { x: number }) => void> = {
    "a reversed set": (tl, o) => void tl.set(o, { x: 100 }, 2).getChildren().at(-1)!.reversed(true),
    "an immediateRender set": (tl, o) => void tl.set(o, { x: 100, immediateRender: true }, 2),
    "a reversed set in a nested timeline playing over the playhead": (tl, o) => {
      const scene = gsap.timeline().to({ y: 0 }, { y: 1, duration: 4 });
      scene.set(o, { x: 100 }, 1.5).getChildren().at(-1)!.reversed(true);
      tl.add(scene, 0.5);
    },
    "a reversed nested timeline": (tl, o) => {
      const scene = gsap.timeline().to(o, { x: 100, duration: 1 });
      tl.add(scene, 2);
      scene.reversed(true);
    },
  };

  it.each(
    Object.keys(shapes).flatMap((shape) => [false, true].map((silent) => ({ shape, silent }))),
  )("draws $shape as without the redraw (arrived silently: $silent)", ({ shape, silent }) => {
    const draws = (redraw: boolean) => {
      const o = { x: 0 };
      const timeline = gsap.timeline({ paused: true }).to({ y: 0 }, { y: 1, duration: 10 });
      shapes[shape]!(timeline, o);
      timeline.totalTime(1, silent);
      if (redraw) rerenderGsapTimelineAt(timeline, 1);
      const atPlayhead = o.x;
      timeline.totalTime(1.01, false);
      return [atPlayhead, o.x];
    };
    expect(draws(true)).toEqual(draws(false));
  });

  it("keeps two sets on the playhead in authored order on the next seek", () => {
    const o = { x: 0 };
    const timeline = gsap.timeline({ paused: true }).to({ y: 0 }, { y: 1, duration: 10 });
    // Only the second set has a callback, so restoring callback tweens alone breaks the order.
    timeline.set(o, { x: 50 }, 2).set(o, { x: 100, onComplete: () => {} }, 2);
    timeline.totalTime(2, false);
    rerenderGsapTimelineAt(timeline, 2);
    timeline.totalTime(2.01, false);
    expect(o.x).toBe(100);
  });

  it("undraws a scene's opening set when stepping back off the scene's start", () => {
    const draws = (redraw: boolean) => {
      const o = { x: 0 };
      const timeline = gsap.timeline({ paused: true }).to({ y: 0 }, { y: 1, duration: 10 });
      timeline.add(gsap.timeline().set(o, { x: 100 }, 0).to({ z: 0 }, { z: 1, duration: 2 }), 2);
      timeline.totalTime(3, false);
      timeline.totalTime(2, false);
      if (redraw) rerenderGsapTimelineAt(timeline, 2);
      timeline.totalTime(1.99, false);
      return o.x;
    };
    expect(draws(true)).toBe(draws(false));
  });

  it("fires a pause in a reversed repeating scene as often as without the redraw", () => {
    const fires = (redraw: boolean) => {
      let fired = 0;
      const timeline = gsap.timeline({ paused: true }).to({ y: 0 }, { y: 1, duration: 10 });
      const scene = gsap.timeline({ repeat: 2, yoyo: true }).to({ z: 0 }, { z: 1, duration: 1 });
      scene.addPause(0, () => void fired++).timeScale(3);
      timeline.add(scene, 1);
      scene.reversed(true);
      timeline.progress(0.0001, true).totalTime(0, false);
      timeline.totalTime(3, true);
      if (redraw) rerenderGsapTimelineAt(timeline, 3);
      timeline.totalTime(2.99, false);
      return fired;
    };
    expect(fires(true)).toBe(fires(false));
  });

  it("renders every frame of style-5-prod's paused typed intro as without the redraw", () => {
    const frames = (redraw: boolean) => {
      const timeline = gsap.timeline({ paused: true }).to({ y: 0 }, { y: 1, duration: 10 });
      const scene = gsap.timeline({ paused: true });
      const typeLine = (text: string, start: number) => {
        const chars = text.split("").map(() => ({ opacity: 0 }));
        const cursor = { opacity: 0 };
        scene.set(cursor, { opacity: 1 }, start);
        chars.forEach((char, i) =>
          scene.to(char, { opacity: 1, duration: 0.01 }, start + i * 0.05),
        );
        const end = start + chars.length * 0.05;
        scene
          .to(cursor, { opacity: 0.25, duration: 0.1 }, end)
          .to(cursor, { opacity: 1, duration: 0.1 }, end + 0.1);
        scene.set(cursor, { opacity: 0 }, end + 0.2);
        return { chars, cursor, end: end + 0.5 };
      };
      const line1 = typeLine("SYSTEM BOOTING...", 0.2);
      const line2 = typeLine("EDITOR AGENT v1.0", line1.end);
      const container = { opacity: 0 };
      scene.fromTo(container, { opacity: 0.92 }, { opacity: 1, duration: 0.6 }, 0);
      timeline.add(scene, 0);
      const drawn: number[][] = [];
      for (let frame = 0; frame < 90; frame++) {
        scene.paused(false);
        timeline.totalTime(frame / 30, false);
        if (redraw) rerenderGsapTimelineAt(timeline, frame / 30);
        scene.paused(true);
        drawn.push(
          [...line1.chars, line1.cursor, ...line2.chars, line2.cursor, container].map(
            (o) => o.opacity,
          ),
        );
      }
      return drawn;
    };
    expect(frames(true)).toEqual(frames(false));
  });

  it("keeps the length of a timeline that grew after its last render", () => {
    const timeline = gsap.timeline({ paused: true }).to({ y: 0 }, { y: 1, duration: 10 });
    timeline.totalTime(1, true);
    timeline.set({ x: 0 }, { x: 100 }, 20);
    rerenderGsapTimelineAt(timeline, 1);
    expect(timeline.duration()).toBe(20);
  });
});
