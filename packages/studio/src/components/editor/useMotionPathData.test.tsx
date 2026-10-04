// @vitest-environment happy-dom
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useMotionPathData } from "./useMotionPathData";
import { resetOverlayFrameLoopForTests } from "./overlayFrameLoop";
import { usePlayerStore } from "../../player/store/playerStore";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const runtime = vi.hoisted(() => ({ read: null as unknown, gsapPosition: null as unknown }));
vi.mock("../../hooks/gsapRuntimeKeyframes", () => ({ readRuntimeKeyframes: () => runtime.read }));
vi.mock("../../hooks/gsapPositionDetection", () => ({
  readGsapPositionFromIframe: () => runtime.gsapPosition,
}));

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
  runtime.read = runtime.gsapPosition = null;
});

it("draws an axis the tween leaves alone where GSAP renders it, so the playhead node sits on the layer", () => {
  runtime.read = {
    keyframes: [
      { percentage: 66.667, properties: { x: 60 } },
      { percentage: 100, properties: { x: 120 } },
    ],
  };
  runtime.gsapPosition = { x: 60, y: 30 };
  let points: string | undefined;
  function Probe() {
    const ref = useRef(document.createElement("iframe"));
    points = useMotionPathData(ref, "#box").geometry?.points;
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  try {
    act(() => root.render(<Probe />));
    expect(points).toBe("60,30 120,30");
  } finally {
    act(() => root.unmount());
  }
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

it("finds the layer whichever window built its node, so the path draws on every load", () => {
  runtime.read = {
    keyframes: [
      { percentage: 0, properties: { x: 0, y: 0 } },
      { percentage: 100, properties: { x: 100, y: 0 } },
    ],
  };
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const box = iframe.contentDocument!.createElement("div");
  box.id = "box";
  iframe.contentDocument!.body.append(box);
  // happy-dom shares one realm, so the frame's own constructor stands in for another window's.
  Object.defineProperty(iframe.contentWindow!, "HTMLElement", { value: class {} });
  let home: unknown = null;
  function Probe() {
    const ref = useRef(iframe);
    home = useMotionPathData(ref, "#box").home;
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  try {
    act(() => root.render(<Probe />));
    runFrames(3);
    expect(home).not.toBeNull();
  } finally {
    act(() => root.unmount());
  }
});

it("redraws a node whose keyframe changes only its size", () => {
  const read = (width: number) => ({
    keyframes: [
      { percentage: 66.667, properties: { x: 60, width } },
      { percentage: 100, properties: { x: 120, width: 320 } },
    ],
  });
  runtime.read = read(280);
  runtime.gsapPosition = { x: 50, y: 30 };
  let w: number | undefined;
  function Probe() {
    const ref = useRef(document.createElement("iframe"));
    w = useMotionPathData(ref, "#box").geometry?.nodes[0]?.w;
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  try {
    act(() => root.render(<Probe />));
    expect(w).toBe(280);
    runtime.read = read(300);
    act(() => vi.advanceTimersByTime(250));
    expect(w).toBe(300);
  } finally {
    act(() => root.unmount());
  }
});
