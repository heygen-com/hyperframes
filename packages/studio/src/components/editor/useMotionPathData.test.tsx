// @vitest-environment happy-dom
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useMotionPathData } from "./useMotionPathData";
import { resetOverlayFrameLoopForTests } from "./overlayFrameLoop";
import { usePlayerStore } from "../../player/store/playerStore";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const originalRaf = window.requestAnimationFrame;
let frames: Array<() => void> = [];
const runFrames = (count: number) => {
  for (let i = 0; i < count; i++) {
    const batch = frames;
    frames = [];
    act(() => {
      for (const frame of batch) frame();
      vi.advanceTimersByTime(16);
    });
  }
};

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"],
  });
  window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    frames.push(() => callback(performance.now()))) as typeof window.requestAnimationFrame;
  usePlayerStore.setState({ previewBooted: true, motionPathArmed: false });
});

afterEach(() => {
  resetOverlayFrameLoopForTests();
  window.requestAnimationFrame = originalRaf;
  vi.useRealTimers();
  usePlayerStore.setState({ previewBooted: false, motionPathArmed: false });
  document.body.innerHTML = "";
});

it("reads no layout per frame until there is a path or a create ring to draw", () => {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const reads = vi.spyOn(iframe, "getBoundingClientRect");
  function Probe() {
    const ref = useRef(iframe);
    useMotionPathData(ref, "#box");
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    act(() => root.render(<Probe />));
    runFrames(10);
    expect(reads).not.toHaveBeenCalled();

    act(() => usePlayerStore.setState({ motionPathArmed: true }));
    runFrames(10);
    expect(reads).toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
  }
});
