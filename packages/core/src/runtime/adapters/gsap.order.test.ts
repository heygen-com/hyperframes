import gsap from "gsap";
import { describe, expect, it } from "vitest";
import { seekGsapTimeline } from "./gsap";
import type { RuntimeTimelineLike } from "../types";

const FPS = 60;
const FRAMES = 150;

// A zoom punch still running when a cut sets the zoom and a slower move starts from wherever the zoom is.
function overlappingZoom() {
  const params = { z: 1 };
  const timeline = gsap.timeline({ paused: true });
  timeline.to(params, { z: 1.45, duration: 0.3, ease: "power4.out" }, 0.573);
  timeline.set(params, { z: 1.04 }, 0.8);
  timeline.to(params, { z: 1.12, duration: 1.39, ease: "power1.in" }, 0.869);
  return { params, timeline: timeline as unknown as RuntimeTimelineLike };
}

/** The zoom at each frame a renderer captures, in order; a scene's clock starts at `hostStart`. */
function capture(frames: number[], hostStart = 0, seekFirst?: number): Map<number, number> {
  const { params, timeline } = overlappingZoom();
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
