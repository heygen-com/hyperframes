// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { TimelineClipFades } from "./TimelineClipFades";
import { TimelineEditProvider } from "../../contexts/TimelineEditContext";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

const clip: TimelineElement = {
  id: "music",
  tag: "audio",
  src: "assets/music.wav",
  start: 2,
  duration: 10,
  track: 1,
  fadeIn: 1,
  fadeOut: 2,
};

function render(
  el: TimelineElement,
  options: { showHandles?: boolean; provide?: boolean; onClipPointerDown?: () => void } = {},
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onSetElementAttributeLive = vi.fn();
  const onSetElementAttributeQuiet = vi.fn().mockResolvedValue(undefined);
  // Stands in for the TimelineClip button the handles live inside.
  const node = (
    <div data-testid="clip" onPointerDown={options.onClipPointerDown}>
      <TimelineClipFades
        el={el}
        pps={100}
        widthPx={el.duration * 100}
        showHandles={options.showHandles ?? true}
      />
    </div>
  );
  act(() => {
    root.render(
      options.provide === false ? (
        node
      ) : (
        <TimelineEditProvider value={{ onSetElementAttributeLive, onSetElementAttributeQuiet }}>
          {node}
        </TimelineEditProvider>
      ),
    );
  });
  return { host, root, onSetElementAttributeLive, onSetElementAttributeQuiet };
}

function pointer(type: string, clientX: number, pointerId = 1) {
  const event = new MouseEvent(type, { bubbles: true, clientX, button: 0 });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  return event;
}

function armCapture(handle: HTMLElement) {
  let captured = false;
  Object.defineProperty(handle, "setPointerCapture", { value: () => (captured = true) });
  Object.defineProperty(handle, "releasePointerCapture", { value: () => (captured = false) });
  Object.defineProperty(handle, "hasPointerCapture", { value: () => captured });
}

describe("TimelineClipFades", () => {
  it("shades the fade-in and fade-out as ramps sized by pps", () => {
    const { host, root } = render(clip, { showHandles: false, provide: false });
    const fadeIn = host.querySelector('[data-testid="clip-fade-in"]');
    const fadeOut = host.querySelector('[data-testid="clip-fade-out"]');
    // 1 s in at 100 px/s: the wedge spans 0..100; 2 s out on a 1000 px clip: 800..1000.
    expect(fadeIn?.getAttribute("points")).toBe("0,0 100,0 0,100");
    expect(fadeOut?.getAttribute("points")).toBe("800,0 1000,0 1000,100");
    // Outside a provider there is nothing to write to, so no handles either.
    expect(host.querySelector('[data-testid="clip-fade-handle-in"]')).toBeNull();
    act(() => root.unmount());
  });

  it("renders nothing for a clip without fades when the handles are hidden", () => {
    const { host, root } = render(
      { ...clip, fadeIn: undefined, fadeOut: undefined },
      {
        showHandles: false,
      },
    );
    expect(host.querySelector('[data-testid="clip"]')?.innerHTML).toBe("");
    act(() => root.unmount());
  });

  it("drags the fade-in dot to the right, previewing live and committing once on release", () => {
    const { host, root, onSetElementAttributeLive, onSetElementAttributeQuiet } = render(clip);
    const handle = host.querySelector<HTMLElement>('[data-testid="clip-fade-handle-in"]');
    if (!handle) throw new Error("expected a fade-in handle");
    armCapture(handle);
    // The handle sits at the 1 s mark (x=100). Drag 150 px right → 2.5 s.
    act(() => handle.dispatchEvent(pointer("pointerdown", 100)));
    act(() => handle.dispatchEvent(pointer("pointermove", 200)));
    act(() => handle.dispatchEvent(pointer("pointermove", 250)));
    expect(onSetElementAttributeLive).toHaveBeenLastCalledWith(clip, "data-fade-in", "2.5");
    expect(onSetElementAttributeQuiet).not.toHaveBeenCalled();
    // The ramp follows the pointer before anything is persisted.
    expect(host.querySelector('[data-testid="clip-fade-in"]')?.getAttribute("points")).toBe(
      "0,0 250,0 0,100",
    );
    act(() => handle.dispatchEvent(pointer("pointerup", 250)));
    expect(onSetElementAttributeQuiet).toHaveBeenCalledTimes(1);
    expect(onSetElementAttributeQuiet).toHaveBeenCalledWith(clip, "data-fade-in", "2.5", "Fade in");
    act(() => root.unmount());
  });

  it("drags the fade-out dot to the left, growing the fade, and never past the fade-in", () => {
    const { host, root, onSetElementAttributeLive, onSetElementAttributeQuiet } = render(clip);
    const handle = host.querySelector<HTMLElement>('[data-testid="clip-fade-handle-out"]');
    if (!handle) throw new Error("expected a fade-out handle");
    armCapture(handle);
    // Handle at x=800 (2 s before the end). 300 px left → 5 s.
    act(() => handle.dispatchEvent(pointer("pointerdown", 800)));
    act(() => handle.dispatchEvent(pointer("pointermove", 500)));
    expect(onSetElementAttributeLive).toHaveBeenLastCalledWith(clip, "data-fade-out", "5");
    // Way past the start: clamps to duration − fadeIn = 9 s.
    act(() => handle.dispatchEvent(pointer("pointermove", -500)));
    expect(onSetElementAttributeLive).toHaveBeenLastCalledWith(clip, "data-fade-out", "9");
    act(() => handle.dispatchEvent(pointer("pointerup", -500)));
    expect(onSetElementAttributeQuiet).toHaveBeenCalledWith(clip, "data-fade-out", "9", "Fade out");
    act(() => root.unmount());
  });

  it("removes the attribute when dragged back to zero", () => {
    const { host, root, onSetElementAttributeQuiet } = render(clip);
    const handle = host.querySelector<HTMLElement>('[data-testid="clip-fade-handle-in"]');
    if (!handle) throw new Error("expected a fade-in handle");
    armCapture(handle);
    act(() => handle.dispatchEvent(pointer("pointerdown", 100)));
    act(() => handle.dispatchEvent(pointer("pointermove", -40)));
    act(() => handle.dispatchEvent(pointer("pointerup", -40)));
    expect(onSetElementAttributeQuiet).toHaveBeenCalledWith(clip, "data-fade-in", null, "Fade in");
    act(() => root.unmount());
  });

  it("puts the live value back and writes nothing when the gesture is cancelled", () => {
    const { host, root, onSetElementAttributeLive, onSetElementAttributeQuiet } = render(clip);
    const handle = host.querySelector<HTMLElement>('[data-testid="clip-fade-handle-in"]');
    if (!handle) throw new Error("expected a fade-in handle");
    armCapture(handle);
    act(() => handle.dispatchEvent(pointer("pointerdown", 100)));
    act(() => handle.dispatchEvent(pointer("pointermove", 300)));
    act(() => handle.dispatchEvent(pointer("pointercancel", 300)));
    expect(onSetElementAttributeLive).toHaveBeenLastCalledWith(clip, "data-fade-in", "1");
    expect(onSetElementAttributeQuiet).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("does not let a press on the dot start the clip's own move gesture", () => {
    const outer = vi.fn();
    const { host, root } = render(clip, { onClipPointerDown: outer });
    const handle = host.querySelector<HTMLElement>('[data-testid="clip-fade-handle-in"]');
    if (!handle) throw new Error("expected a fade-in handle");
    armCapture(handle);
    act(() => handle.dispatchEvent(pointer("pointerdown", 100)));
    expect(outer).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
