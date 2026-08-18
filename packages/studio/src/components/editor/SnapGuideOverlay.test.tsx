// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { SnapGuideOverlay, type SnapGuidesState } from "./SnapGuideOverlay";
import { createGestureActiveRef, type GestureActiveRef } from "./overlayFrameLoop";
import {
  countScheduledFrames,
  flushAnimationFrames,
  restoreAnimationFrameCounter,
} from "./overlayLoopTestKit";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(
  snapGuidesRef: { current: SnapGuidesState | null },
  gestureActiveRef: GestureActiveRef,
): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <SnapGuideOverlay
        snapGuidesRef={snapGuidesRef}
        gestureActiveRef={gestureActiveRef}
        compositionLeft={0}
        compositionTop={0}
        compositionWidth={800}
        compositionHeight={450}
      />,
    );
  });
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  restoreAnimationFrameCounter();
});

const guideElements = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>("div[style]")).filter(
    (el) => el.style.position === "absolute",
  );

describe("SnapGuideOverlay", () => {
  it("schedules no frames and writes no styles while no gesture runs", async () => {
    const snapGuidesRef = { current: null as SnapGuidesState | null };
    const container = mount(snapGuidesRef, createGestureActiveRef());
    const [first] = guideElements(container);
    if (!first) throw new Error("Expected guide slots to render");
    await flushAnimationFrames(3);

    // A sentinel the idle loop would clobber if it were still writing every
    // frame — the original implementation reset display on all ten slots.
    first.style.display = "block";
    const scheduled = countScheduledFrames();
    await flushAnimationFrames(6);

    expect(scheduled()).toBe(0);
    expect(first.style.display).toBe("block");
  });

  it("starts on a gesture, draws a guide crossed mid-drag, then clears once and stops", async () => {
    const snapGuidesRef = { current: null as SnapGuidesState | null };
    const gestureActiveRef = createGestureActiveRef();
    const container = mount(snapGuidesRef, gestureActiveRef);
    const [first] = guideElements(container);
    if (!first) throw new Error("Expected guide slots to render");
    await flushAnimationFrames(3);

    // A drag starts before it snaps to anything: the guide appears mid-drag,
    // with nothing but the gesture flag to have kept the loop alive for it.
    act(() => {
      gestureActiveRef.current = true;
    });
    await flushAnimationFrames(3);
    snapGuidesRef.current = {
      guides: [{ axis: "x", position: 120, from: 0, to: 450 }],
      spacingGuides: [],
    };
    await flushAnimationFrames(3);

    expect(first.style.display).toBe("");
    expect(first.style.left).toBe("120px");
    expect(first.style.height).toBe("450px");

    // Gesture end clears the guides and lowers the flag, in that order.
    snapGuidesRef.current = null;
    act(() => {
      gestureActiveRef.current = false;
    });
    await flushAnimationFrames(3);
    expect(first.style.display).toBe("none");

    // ...and the clearing pass is the last write: a sentinel survives after it,
    // and no further frame is scheduled.
    first.style.display = "block";
    const scheduled = countScheduledFrames();
    await flushAnimationFrames(6);
    expect(scheduled()).toBe(0);
    expect(first.style.display).toBe("block");
  });

  it("runs nothing after unmounting mid-gesture", async () => {
    const snapGuidesRef = { current: null as SnapGuidesState | null };
    const gestureActiveRef = createGestureActiveRef();
    const container = mount(snapGuidesRef, gestureActiveRef);
    const [first] = guideElements(container);
    if (!first) throw new Error("Expected guide slots to render");

    act(() => {
      gestureActiveRef.current = true;
    });
    snapGuidesRef.current = {
      guides: [{ axis: "x", position: 120, from: 0, to: 450 }],
      spacingGuides: [],
    };
    act(() => root?.unmount());

    first.style.display = "block";
    const scheduled = countScheduledFrames();
    await flushAnimationFrames(6);

    expect(scheduled()).toBe(0);
    expect(first.style.display).toBe("block");
  });
});
