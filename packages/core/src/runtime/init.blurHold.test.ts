import { afterEach, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import { createMockTimeline, resetRuntimeFixtureDom } from "./runtimeSeekFixture.test-helpers";

const blur = vi.hoisted(() => ({ busy: false, paints: [] as number[] }));

vi.mock("./captureMotionBlur", async (original) => ({
  ...(await original<typeof import("./captureMotionBlur")>()),
  captureMotionBlurBusy: () => blur.busy,
  paintCaptureMotionBlur: (t: number) => {
    blur.paints.push(t);
    return null;
  },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  blur.busy = false;
  blur.paints = [];
});

function mountPlaying() {
  resetRuntimeFixtureDom();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => frames.push(callback));
  document.body.innerHTML =
    '<div data-composition-id="main" data-root="true" data-duration="60"><div id="clip" data-start="0" data-duration="60"></div></div>';
  const main = createMockTimeline(60);
  const seeks: number[] = [];
  const totalTime = main.totalTime;
  main.totalTime = (time?: number) => {
    if (time !== undefined) seeks.push(time);
    return totalTime(time);
  };
  window.__timelines = { main };
  initSandboxRuntimeModular();
  const tick = (count = 1) => {
    for (let i = 0; i < count; i += 1) {
      for (const callback of frames.splice(0)) callback(performance.now());
      vi.advanceTimersByTime(20);
    }
  };
  tick(10);
  window.__player!.play();
  tick(2);
  return { tick, seeks };
}

it("holds playback seeks and paints while a blurred frame is in flight, then catches up", () => {
  const { tick, seeks } = mountPlaying();
  blur.busy = false;
  tick(3);
  expect(seeks.length).toBeGreaterThan(0);
  expect(blur.paints.length).toBeGreaterThan(0);

  blur.busy = true;
  seeks.length = 0;
  blur.paints.length = 0;
  tick(5);
  expect(seeks).toEqual([]);
  expect(blur.paints).toEqual([]);

  blur.busy = false;
  tick(2);
  expect(seeks.length).toBeGreaterThan(0);
  expect(blur.paints.length).toBeGreaterThan(0);
  window.__player!.pause();
});

it("never holds a seek or a paused paint", () => {
  const { tick, seeks } = mountPlaying();
  window.__player!.pause();
  tick(2);
  blur.busy = true;
  seeks.length = 0;
  window.__player!.seek(5);
  tick(2);
  expect(seeks).toContain(5);
});
