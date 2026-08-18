// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useDomEditOverlayRects } from "./useDomEditOverlayRects";
import { createGestureActiveRef, type OverlayFrameLoop } from "./overlayFrameLoop";
import {
  countScheduledFrames,
  flushAnimationFrames,
  restoreAnimationFrameCounter,
  testDomRect as domRect,
} from "./overlayLoopTestKit";
import type { DomEditSelection } from "./domEditing";
import type { OverlayRect } from "./domEditOverlayGeometry";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  restoreAnimationFrameCounter();
});

interface Harness {
  gestureActiveRef: ReturnType<typeof createGestureActiveRef>;
  loopRef: { current: OverlayFrameLoop | null };
  setSelection: (selection: DomEditSelection | null) => void;
  moveElement: (left: number) => void;
  readOverlayRect: () => OverlayRect | null;
}

function mountHook(): Harness {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const doc = iframe.contentDocument;
  if (!doc) throw new Error("Expected iframe content document");
  doc.body.innerHTML = `
    <div data-composition-id="root" data-width="800" data-height="450">
      <div id="headline" style="position:absolute; left:40px; top:40px; width:100px; height:40px;">Headline</div>
    </div>
  `;
  const element = doc.getElementById("headline");
  if (!element) throw new Error("Expected test element");

  const overlay = document.createElement("div");
  document.body.append(overlay);

  Element.prototype.getBoundingClientRect = function (): DOMRect {
    if (this === element) {
      return domRect(
        Number.parseFloat(element.style.left),
        Number.parseFloat(element.style.top),
        100,
        40,
      );
    }
    return domRect(0, 0, 800, 450);
  };

  const selectionRef: { current: DomEditSelection | null } = { current: null };
  const gestureActiveRef = createGestureActiveRef();
  const loopRef: { current: OverlayFrameLoop | null } = { current: null };
  let overlayRect: OverlayRect | null = null;

  function Probe(): React.ReactElement {
    const rects = useDomEditOverlayRects({
      iframeRef: { current: iframe },
      overlayRef: { current: overlay },
      selectionRef,
      activeCompositionPathRef: { current: null },
      groupSelectionsRef: { current: [] },
      hoverSelectionRef: { current: null },
      gestureActiveRef,
      loopRef,
    });
    overlayRect = rects.overlayRect;
    return <span>{rects.overlayRect?.left ?? -1}</span>;
  }

  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<Probe />));

  return {
    gestureActiveRef,
    loopRef,
    setSelection: (selection) => {
      selectionRef.current = selection;
      act(() => root?.render(<Probe />));
    },
    moveElement: (left) => {
      element.style.left = `${left}px`;
    },
    readOverlayRect: () => overlayRect,
  };
}

function selectionForHeadline(): DomEditSelection {
  return { id: "headline", sourceFile: "index.html" } as unknown as DomEditSelection;
}

describe("useDomEditOverlayRects", () => {
  it("schedules no frames at idle", async () => {
    const harness = mountHook();
    harness.setSelection(selectionForHeadline());
    await flushAnimationFrames(4);
    expect(harness.readOverlayRect()?.left).toBe(40);

    const scheduled = countScheduledFrames();
    await flushAnimationFrames(8);
    expect(scheduled()).toBe(0);
  });

  it("re-arms when the selection changes", async () => {
    const harness = mountHook();
    await flushAnimationFrames(4);
    expect(harness.readOverlayRect()).toBeNull();

    harness.setSelection(selectionForHeadline());
    await flushAnimationFrames(3);

    expect(harness.readOverlayRect()?.left).toBe(40);
  });

  it("re-arms when a gesture ends and picks up where the gesture left the element", async () => {
    const harness = mountHook();
    harness.setSelection(selectionForHeadline());
    await flushAnimationFrames(4);
    expect(harness.readOverlayRect()?.left).toBe(40);

    // A gesture drives the box imperatively, so the loop stands down for it.
    act(() => {
      harness.gestureActiveRef.current = true;
    });
    harness.moveElement(300);
    await flushAnimationFrames(4);
    expect(harness.readOverlayRect()?.left).toBe(40);

    act(() => {
      harness.gestureActiveRef.current = false;
    });
    await flushAnimationFrames(3);

    expect(harness.readOverlayRect()?.left).toBe(300);
  });

  it("re-arms when refreshOverlayGeometry arms the loop", async () => {
    const harness = mountHook();
    harness.setSelection(selectionForHeadline());
    await flushAnimationFrames(4);

    // What a preview-DOM mutation, a zoom/pan or an iframe swap reduces to.
    harness.moveElement(220);
    act(() => harness.loopRef.current?.arm());
    await flushAnimationFrames(3);

    expect(harness.readOverlayRect()?.left).toBe(220);
  });

  it("runs nothing after unmounting while armed", async () => {
    const harness = mountHook();
    harness.setSelection(selectionForHeadline());
    await flushAnimationFrames(4);

    act(() => harness.loopRef.current?.arm());
    act(() => root?.unmount());
    const scheduled = countScheduledFrames();
    harness.moveElement(500);
    await flushAnimationFrames(6);

    expect(scheduled()).toBe(0);
    expect(harness.readOverlayRect()?.left).toBe(40);
  });
});
