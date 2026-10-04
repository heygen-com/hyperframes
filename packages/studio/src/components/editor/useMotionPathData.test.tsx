// @vitest-environment happy-dom
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { elementHome, useMotionPathData } from "./useMotionPathData";
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

/** A layer laid out at (960, 540), 240 x 160, with `css` inline and GSAP reporting `percent`. */
function layer(css: Partial<CSSStyleDeclaration>, percent: Record<string, number> = {}) {
  const el = document.body.appendChild(document.createElement("div"));
  Object.assign(el.style, css);
  const box = {
    offsetLeft: 960,
    offsetTop: 540,
    offsetWidth: 240,
    offsetHeight: 160,
    offsetParent: null,
  };
  for (const [key, value] of Object.entries(box)) Object.defineProperty(el, key, { value });
  vi.stubGlobal("gsap", { getProperty: (_: Element, prop: string) => percent[prop] ?? 0 });
  return el;
}

it("anchors a layer that xPercent/yPercent -50 centres (CSS translate -50% folds into them) on its centre", () => {
  try {
    const el = layer(
      { position: "absolute", left: "50%", top: "50%" },
      { xPercent: -50, yPercent: -50 },
    );
    expect(elementHome(el)).toEqual({ x: 960, y: 540, w: 240, h: 160, ax: 0, ay: 0 });
  } finally {
    vi.unstubAllGlobals();
  }
});

it("moves a resized layer's centre by half the change from a set left, against it from a set right, and not in flow", () => {
  try {
    const fromLeft = layer({ position: "absolute", left: "10px", top: "10px" });
    expect(elementHome(fromLeft)).toMatchObject({ x: 1080, y: 620, ax: 0.5, ay: 0.5 });
    const fromRight = layer({ position: "absolute", right: "10px", bottom: "10px" });
    const auto = new Set(["left", "top"]);
    fromRight.computedStyleMap = () =>
      ({
        get: (side: string) => (auto.has(side) ? "auto" : "10px"),
      }) as unknown as StylePropertyMapReadOnly;
    expect(elementHome(fromRight)).toMatchObject({ ax: -0.5, ay: -0.5 });
    expect(elementHome(layer({}))).toMatchObject({ x: 1080, ax: 0, ay: 0 });
  } finally {
    vi.unstubAllGlobals();
  }
});

it("redraws the start ring when only GSAP's start changes", () => {
  const read = (start?: Record<string, number>) => ({
    keyframes: [
      { percentage: 50, properties: { x: 60 } },
      { percentage: 100, properties: { x: 120 } },
    ],
    ...(start && { start }),
  });
  runtime.read = read();
  runtime.gsapPosition = { x: 50, y: 30 };
  let start: unknown;
  function Probe() {
    const ref = useRef(document.createElement("iframe"));
    start = useMotionPathData(ref, "#box").geometry?.start;
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  try {
    act(() => root.render(<Probe />));
    expect(start).toBeUndefined();
    runtime.read = read({ x: 40 });
    act(() => vi.advanceTimersByTime(250));
    expect(start).toEqual({ x: 40, y: 30 });
  } finally {
    act(() => root.unmount());
  }
});

it("updates the home when the layer's size changes but its centre does not", () => {
  runtime.read = {
    keyframes: [
      { percentage: 0, properties: { x: 0, width: 200 } },
      { percentage: 100, properties: { x: 100, width: 240 } },
    ],
  };
  const iframe = document.body.appendChild(document.createElement("iframe"));
  const layout = { offsetLeft: 100, offsetWidth: 200 };
  const box = iframe.contentDocument!.body.appendChild(
    iframe.contentDocument!.createElement("div"),
  );
  box.id = "box";
  for (const key of ["offsetLeft", "offsetWidth"] as const)
    Object.defineProperty(box, key, { get: () => layout[key] });
  let w: number | undefined;
  function Probe() {
    const ref = useRef(iframe);
    w = useMotionPathData(ref, "#box").home?.w;
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  try {
    act(() => root.render(<Probe />));
    runFrames(2);
    expect(w).toBe(200);
    Object.assign(layout, { offsetLeft: 80, offsetWidth: 240 });
    runFrames(2);
    expect(w).toBe(240);
  } finally {
    act(() => root.unmount());
  }
});
