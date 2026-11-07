import gsap from "gsap";
import { describe, expect, it } from "vitest";
import { rerenderGsapTimelineAt, seekGsapTimeline } from "./gsap";
import { producerStandIn } from "./gsapStandIn.test-helpers";
import type { RuntimeTimelineLike } from "../types";

const FPS = 60;
const FRAMES = 150;

// A zoom punch still running when a cut sets the zoom and a slower move starts from wherever the zoom is.
function overlappingZoom(standIn = false) {
  const params = { z: 1 };
  const timeline = gsap.timeline({ paused: true });
  timeline.to(params, { z: 1.45, duration: 0.3, ease: "power4.out" }, 0.573);
  timeline.set(params, { z: 1.04 }, 0.8);
  timeline.to(params, { z: 1.12, duration: 1.39, ease: "power1.in" }, 0.869);
  return {
    params,
    timeline: standIn ? producerStandIn(timeline) : (timeline as unknown as RuntimeTimelineLike),
  };
}

/** The zoom at each frame a renderer captures, in order; a scene's clock starts at `hostStart`. */
function capture(
  frames: number[],
  hostStart = 0,
  seekFirst?: number,
  standIn = false,
): Map<number, number> {
  const { params, timeline } = overlappingZoom(standIn);
  const zoom = new Map<number, number>();
  if (seekFirst !== undefined) seekGsapTimeline(timeline, seekFirst, true, undefined, FPS);
  for (const frame of frames) {
    seekGsapTimeline(timeline, frame / FPS - hostStart, true, undefined, FPS);
    zoom.set(frame, params.z);
  }
  return zoom;
}

const range = (from: number, to: number, step = 1) =>
  Array.from({ length: Math.ceil((to - from) / step) }, (_, i) => from + i * step);

describe("a render that captures frames out of order", () => {
  const inOrder = capture(range(0, FRAMES));

  it("gives every frame the same value when 8 workers each capture every 8th frame", () => {
    for (let worker = 0; worker < 8; worker++) {
      for (const [frame, z] of capture(range(worker, FRAMES, 8))) {
        expect([frame, z]).toEqual([frame, inOrder.get(frame)]);
      }
    }
  });

  it("gives every frame the same value when the producer hands out a stand-in for the timeline", () => {
    for (let worker = 0; worker < 8; worker++) {
      for (const [frame, z] of capture(range(worker, FRAMES, 8), 0, undefined, true)) {
        expect([frame, z]).toEqual([frame, inOrder.get(frame)]);
      }
    }
  });

  it("gives every frame the same value when a chunk starts inside the overlap", () => {
    for (const [frame, z] of capture(range(53, FRAMES))) {
      expect([frame, z]).toEqual([frame, inOrder.get(frame)]);
    }
  });

  it("gives every frame the same value in a scene whose host starts between two frames", () => {
    const hostStart = 0.0125;
    const sceneInOrder = capture(range(1, FRAMES), hostStart);
    for (let worker = 0; worker < 8; worker++) {
      for (const [frame, z] of capture(range(worker + 1, FRAMES, 8), hostStart)) {
        expect(z).toBeCloseTo(sceneInOrder.get(frame)!, 9);
      }
    }
  });

  it("gives every frame the same value when a scene held at 0 jumps to a chunk start between two frames", () => {
    const hostStart = 0.0125;
    const sceneInOrder = capture(range(1, FRAMES), hostStart);
    for (const [frame, z] of capture(range(53, FRAMES), hostStart, 0)) {
      expect(z).toBeCloseTo(sceneInOrder.get(frame)!, 9);
    }
  });

  it("replays no frame when no two tweens write the same property at once", () => {
    const rendersOfTwoSeeks = (fps?: number) => {
      const [a, b, c, d] = [{ x: 0 }, { x: 0 }, { x: 0 }, { x: 0 }];
      const timeline = gsap.timeline({ paused: true });
      timeline
        .to(a, { x: 1, duration: 2 }, 0)
        .to(b, { x: 1, duration: 2 }, 0)
        .to(a, { x: 2, duration: 1 }, 2);
      const pausedScene = gsap
        .timeline()
        .to(c, { x: 1, duration: 1 })
        .to(c, { x: 2, duration: 1 }, 0.5);
      timeline.add(pausedScene, 0.3);
      pausedScene.pause();
      timeline.add(gsap.timeline({ repeat: 3, yoyo: true }).to(d, { x: 1, duration: 0.5 }), 0);
      const film = timeline as unknown as RuntimeTimelineLike;
      let renders = 0;
      const totalTime = film.totalTime!.bind(film);
      film.totalTime = (...args) => (args.length ? (renders++, totalTime(...args)) : totalTime());
      seekGsapTimeline(film, 0, true, undefined, fps);
      seekGsapTimeline(film, 170 / FPS, true, undefined, fps);
      return [renders, a.x, b.x, c.x, d.x];
    };
    expect(rendersOfTwoSeeks(FPS)).toEqual(rendersOfTwoSeeks());
  });
});

// A panel fading out while a set brings it back: the set is what preview and a seek show once the fade has ended.
function fadeInterruptedBySet(standIn: boolean) {
  const panel = { opacity: 1 };
  const timeline = gsap.timeline({ paused: true });
  timeline.fromTo(panel, { opacity: 1 }, { opacity: 0, duration: 1, ease: "none" }, 0);
  timeline.set(panel, { opacity: 1 }, 0.3);
  return {
    panel,
    timeline: standIn ? producerStandIn(timeline) : (timeline as unknown as RuntimeTimelineLike),
  };
}

const SET_FPS = 30;

/** The panel at each frame, rendered when `fps` is given, previewed when it is not. */
function panelAt(frames: number[], fps?: number, standIn = false): Map<number, number> {
  const { panel, timeline } = fadeInterruptedBySet(standIn);
  const structure = { owner: timeline, version: "1" };
  const opacity = new Map<number, number>();
  for (const frame of frames) {
    seekGsapTimeline(timeline, frame / SET_FPS, true, structure, fps);
    opacity.set(frame, panel.opacity);
  }
  return opacity;
}

/** The panel at each frame through both steps of a real seek: the seek, then the runtime's re-render. */
function panelThroughRuntimeSeek(frames: number[], standIn = false): Map<number, number> {
  const { panel, timeline } = fadeInterruptedBySet(standIn);
  const opacity = new Map<number, number>();
  for (const frame of frames) {
    const t = frame / SET_FPS;
    if (!seekGsapTimeline(timeline, t, false, undefined, SET_FPS)) {
      rerenderGsapTimelineAt(
        {
          totalTime: timeline.totalTime!.bind(timeline),
          totalDuration: timeline.totalDuration?.bind(timeline),
          getChildren: timeline.getChildren?.bind(timeline),
        },
        t,
      );
    }
    opacity.set(frame, panel.opacity);
  }
  return opacity;
}

describe("a render where a set interrupts a running tween", () => {
  const preview = panelAt(range(0, 90));

  it("keeps the set's value through the runtime's re-render, however frames are shared out", () => {
    for (const standIn of [false, true]) {
      for (const workers of [1, 2, 3, 4, 6]) {
        for (let worker = 0; worker < workers; worker++) {
          for (const [frame, opacity] of panelThroughRuntimeSeek(
            range(worker, 90, workers),
            standIn,
          )) {
            if (frame >= SET_FPS) expect([workers, frame, opacity]).toEqual([workers, frame, 1]);
          }
        }
      }
    }
  });

  it("lands every frame where preview does when one worker renders in order", () => {
    for (const [frame, opacity] of panelAt(range(0, 90), SET_FPS)) {
      expect([frame, opacity]).toEqual([frame, preview.get(frame)]);
    }
  });

  it("lands every frame where preview does when workers start partway through", () => {
    for (const start of [5, 15, 29, 31, 45]) {
      for (const [frame, opacity] of panelAt(range(start, 90), SET_FPS)) {
        expect([start, frame, opacity]).toEqual([start, frame, preview.get(frame)]);
      }
    }
  });

  it("lands every frame where preview does behind the producer's timeline stand-in", () => {
    for (const start of [0, 15, 45]) {
      for (const [frame, opacity] of panelAt(range(start, 90), SET_FPS, true)) {
        expect([start, frame, opacity]).toEqual([start, frame, preview.get(frame)]);
      }
    }
  });

  it("shows the set's value after the tween ends, whichever way the frames are shared out", () => {
    for (let worker = 0; worker < 6; worker++) {
      for (const [frame, opacity] of panelAt(range(worker, 90, 6), SET_FPS)) {
        if (frame / SET_FPS >= 1) expect([frame, opacity]).toEqual([frame, 1]);
      }
    }
  });
});

describe("a fromTo beside a set on another property of the same element", () => {
  it("renders forward without rewinding the timeline when the fromTo ends", () => {
    const tile = { x: 0, opacity: 1 };
    const real = gsap.timeline({ paused: true });
    real.fromTo(tile, { x: 0 }, { x: 100, duration: 1, ease: "none" }, 0);
    real.set(tile, { opacity: 0 }, 0);
    real.to(tile, { x: 200, duration: 1, ease: "none" }, 1);
    const landed: number[] = [];
    const timeline = producerStandIn(real);
    const totalTime = timeline.totalTime!;
    timeline.totalTime = ((...args: [number, boolean?]) => {
      if (args.length > 0) landed.push(args[0]);
      return totalTime(...args);
    }) as typeof totalTime;
    const structure = { owner: timeline, version: "1" };
    seekGsapTimeline(timeline, 0, true, structure, 30);
    landed.length = 0;
    for (const frame of range(1, 60)) seekGsapTimeline(timeline, frame / 30, true, structure, 30);
    expect(landed.filter((t, i) => i > 0 && t < landed[i - 1]!)).toEqual([]);
    expect(tile.x).toBeCloseTo(100 + 100 * (59 / 30 - 1), 5);
  });
});
