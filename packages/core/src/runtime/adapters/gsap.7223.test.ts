import gsap from "gsap";
import { describe, expect, it } from "vitest";
import { seekGsapTimeline } from "./gsap";
import type { RuntimeTimelineLike } from "../types";

const FPS = 30;
const FRAMES = 90;

// #7223: a set and a second tween land while a tween on the same property runs,
// on a real DOM element like the issue's repro (box scale).
// A zoom punch (0-1s), a cut sets the zoom at 0.5s, a slow move starts at 0.55s.
function overlappingSetAndTween() {
  const box = document.createElement("div");
  document.body.appendChild(box);
  const timeline = gsap.timeline({ paused: true });
  timeline.to(box, { scale: 1.6, duration: 1, ease: "none" }, 0);
  timeline.set(box, { scale: 1.0 }, 0.5);
  timeline.to(box, { scale: 2, duration: 2, ease: "none" }, 0.55);
  return { box, timeline };
}

/**
 * Minimal stand-in for the producer's GSAP early stub (stubs/hf-early-stub.ts):
 * the composition's `gsap.timeline()` call returns this proxy, whose
 * `__hfReal` is the real timeline. The runtime seeks the proxy; a tween's
 * parent chain holds the real timeline. Deliberately thin: only the methods
 * the seek path touches, each delegating to the real timeline.
 */
function wrapTimeline(real: gsap.core.Timeline): RuntimeTimelineLike {
  const proxy = {
    __hfReal: real,
    totalTime: (time?: number, suppressEvents?: boolean) => {
      if (time === undefined) return real.totalTime();
      real.totalTime(time, suppressEvents);
      return proxy;
    },
    totalDuration: () => real.totalDuration(),
    getChildren: (...args: [boolean, boolean, boolean]) => real.getChildren(...args),
    paused: (value?: boolean) => {
      if (value === undefined) return real.paused();
      real.paused(value);
      return proxy;
    },
    timeScale: (value?: number) => {
      if (value === undefined) return real.timeScale();
      real.timeScale(value);
      return proxy;
    },
    pause: () => {
      real.pause();
      return proxy;
    },
    play: () => {
      real.play();
      return proxy;
    },
    seek: (time?: number, suppressEvents?: boolean) => {
      real.seek(time, suppressEvents);
      return proxy;
    },
    duration: () => real.duration(),
    time: () => real.time(),
  };
  return proxy as unknown as RuntimeTimelineLike;
}

/** The box scale at each frame a renderer captures, in order. */
function capture(frames: number[], useProxy: boolean): Map<number, number> {
  const { box, timeline } = overlappingSetAndTween();
  const target: RuntimeTimelineLike = useProxy
    ? wrapTimeline(timeline)
    : (timeline as unknown as RuntimeTimelineLike);
  const scale = new Map<number, number>();
  for (const frame of frames) {
    seekGsapTimeline(target, frame / FPS, true, undefined, FPS);
    scale.set(frame, gsap.getProperty(box, "scale") as number);
  }
  box.remove();
  return scale;
}

const range = (from: number, to: number, step = 1) =>
  Array.from({ length: Math.ceil((to - from) / step) }, (_, i) => from + i * step);

describe("#7223 set and tween inside a running tween", () => {
  const inOrder = capture(range(0, FRAMES), false);

  it("gives every frame the same value when 8 workers each capture every 8th frame", () => {
    for (let worker = 0; worker < 8; worker++) {
      for (const [frame, scale] of capture(range(worker, FRAMES, 8), false)) {
        expect([frame, scale]).toEqual([frame, inOrder.get(frame)]);
      }
    }
  });

  // The real render distributes contiguous chunks (distributeFrames) and
  // seeks the stub's proxy timeline, not the real one: worker 2's first
  // seek jumps straight to frame 24. Before the fix the overlap spans came
  // back empty (the parent walk ran past the proxy into the paused real
  // timeline, whose _ts is 0), so no frames were replayed and the second
  // tween started from the set's value instead of the running tween's.
  it("gives every frame the same value when 8 chunked workers seek a proxy timeline", () => {
    const framesPerWorker = Math.ceil(FRAMES / 8);
    const inOrderProxy = capture(range(0, FRAMES), true);
    for (let worker = 0; worker < 8; worker++) {
      const start = worker * framesPerWorker;
      const end = Math.min(start + framesPerWorker, FRAMES);
      if (start >= FRAMES) break;
      for (const [frame, scale] of capture(range(start, end), true)) {
        expect([frame, scale]).toEqual([frame, inOrderProxy.get(frame)]);
      }
    }
  });
});
