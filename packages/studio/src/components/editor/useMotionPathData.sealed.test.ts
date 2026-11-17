// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
// The frame's real runtime agent, serving the opaque frame from this document.
import { installMarkedEditingAgent } from "../../../../core/src/runtime/editingAgent.test-helpers";
import { detachedFakeIframe } from "../../player/hooks/timelinePlayerTestHarness";
import { usePlayerStore } from "../../player/store/playerStore";
import { resetOverlayFrameLoopForTests } from "./overlayFrameLoop";
import { useMotionPathData } from "./useMotionPathData";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const closers: Array<() => void> = [];
const originalRaf = window.requestAnimationFrame;
let frames: Array<() => void> = [];
const runFrames = () =>
  act(() => {
    const batch = frames;
    frames = [];
    for (const frame of batch) frame();
  });

beforeEach(() => {
  window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    frames.push(() => callback(performance.now()))) as typeof window.requestAnimationFrame;
  // Armed, so the hook measures the layer before there is a path to draw.
  usePlayerStore.setState({ previewBooted: true, motionPathArmed: true });
});
afterEach(() => {
  closers.splice(0).forEach((close) => close());
  resetOverlayFrameLoopForTests();
  window.requestAnimationFrame = originalRaf;
  usePlayerStore.setState({ previewBooted: false, motionPathArmed: false });
  document.body.innerHTML = "";
});

/** A frame Studio cannot read, whose runtime is the real editing agent over this document. */
function opaqueFrame() {
  const frame: Record<string, unknown> = {};
  const iframe = detachedFakeIframe(frame);
  Object.defineProperty(iframe, "contentDocument", { value: null });
  Object.defineProperty(frame, "document", {
    get: () => {
      throw new DOMException("blocked", "SecurityError");
    },
  });
  const parent = {
    postMessage: (data: unknown, _origin: string, ports: MessagePort[]) =>
      window.dispatchEvent(
        new MessageEvent("message", { source: frame as unknown as Window, data, ports }),
      ),
  } as unknown as Window;
  const agent = installMarkedEditingAgent(parent);
  frame.postMessage = (data: unknown) =>
    window.dispatchEvent(new MessageEvent("message", { source: parent, data }));
  closers.push(() => agent.dispose());
  return iframe;
}

// fails without the fix: the hook read the layer from the frame's document, which a sealed frame keeps.
it("finds a sealed preview's layer home, so its motion path draws from the layer", async () => {
  document.body.innerHTML = `<main data-composition-id="main"><div id="box"></div></main>`;
  const box = document.getElementById("box")!;
  const layout = { offsetLeft: 100, offsetTop: 50, offsetWidth: 200, offsetHeight: 100 };
  for (const [key, value] of Object.entries(layout)) Object.defineProperty(box, key, { value });
  const iframe = opaqueFrame();
  let home: unknown = null;
  function Probe() {
    const ref = useRef(iframe);
    home = useMotionPathData(ref, "#box").home;
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  try {
    act(() => root.render(createElement(Probe)));
    await vi.waitFor(() => {
      runFrames();
      expect(home).toEqual({ x: 200, y: 100, w: 200, h: 100, ax: 0, ay: 0 });
    });
  } finally {
    act(() => root.unmount());
  }
});
