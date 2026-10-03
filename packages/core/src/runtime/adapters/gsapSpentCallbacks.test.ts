import { describe, it, expect, vi } from "vitest";
import gsap from "gsap";
import { keepLandedGsapCallbacksSpent } from "./gsapSpentCallbacks";

type Timeline = ReturnType<typeof gsap.timeline>;

// Pins the GSAP private fields keepLandedGsapCallbacksSpent reads and writes. If a GSAP upgrade
// fails here, motion-blur renders fire frame-time callbacks twice again.
describe("keepLandedGsapCallbacksSpent against real GSAP", () => {
  // One blurred frame at 0.5: the eventful seek, a sample on each side, the silent return.
  const blurredFrameAt05 = (timeline: Timeline, keepSpent: boolean) => {
    timeline.totalTime(0.5, false);
    if (keepSpent) keepLandedGsapCallbacksSpent(timeline, { keepFiredCallbacksSpent: true });
    timeline.totalTime(0.45, true);
    timeline.totalTime(0.55, true);
    timeline.totalTime(0.5, true);
    if (keepSpent) {
      keepLandedGsapCallbacksSpent(timeline, {
        suppressEvents: true,
        keepFiredCallbacksSpent: true,
      });
    }
  };
  const timelineWithCallAt = (at: number, fired: () => void) =>
    gsap.timeline({ paused: true }).to({ x: 0 }, { x: 1, duration: 1 }).call(fired, [], at);

  it("leaves a fired call armed after a silent return, with the fields it reads", () => {
    const timeline = timelineWithCallAt(0.5, vi.fn());
    blurredFrameAt05(timeline, false);
    const call = timeline.getChildren(true, true, false)[1] as unknown as Record<string, unknown>;
    expect(call).toMatchObject({ _dur: 0, _zTime: 1e-8, ratio: 1 });
  });

  it("without it, the next eventful seek fires that call again", () => {
    const fired = vi.fn();
    const timeline = timelineWithCallAt(0.5, fired);
    blurredFrameAt05(timeline, false);
    timeline.totalTime(0.6, false);
    expect(fired).toHaveBeenCalledTimes(2);
  });

  it("with it, the call stays spent and a call a sample only passed still fires", () => {
    const fired = vi.fn();
    const passed = vi.fn();
    const timeline = timelineWithCallAt(0.5, fired).call(passed, [], 0.52);
    blurredFrameAt05(timeline, true);
    timeline.totalTime(0.6, false);
    expect(fired).toHaveBeenCalledTimes(1);
    expect(passed).toHaveBeenCalledTimes(1);
  });

  it("with it, a call the eventful seek did not fire still fires on the next frame", () => {
    const fired = vi.fn();
    const scene = gsap.timeline().call(fired, [], 0).to({ y: 0 }, { y: 1, duration: 0.5 }, 0);
    const timeline = gsap.timeline({ paused: true }).to({ x: 0 }, { x: 1, duration: 1 });
    timeline.add(scene, 0.5);
    blurredFrameAt05(timeline, true);
    timeline.totalTime(0.6, false);
    expect(fired).toHaveBeenCalledTimes(1);
  });
});
