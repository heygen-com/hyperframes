// @vitest-environment happy-dom

import React, { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { DomEditSelection } from "./domEditing";
import { useDomEditOverlayRects } from "./useDomEditOverlayRects";
import { requestOverlayFrames, resetOverlayFrameLoopForTests } from "./overlayFrameLoop";
import { usePlayerStore } from "../../player/store/playerStore";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const originalRaf = window.requestAnimationFrame;
let queued: Array<() => void> = [];

beforeEach(() => {
  usePlayerStore.setState({ previewBooted: true });
  queued = [];
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    queued.push(() => callback(performance.now()));
    return queued.length;
  }) as typeof window.requestAnimationFrame;
});

afterEach(() => {
  window.requestAnimationFrame = originalRaf;
  resetOverlayFrameLoopForTests();
});

/** Mounts the hook over a preview with one `#box` and returns how many rect reads `frames` frames cost. */
function rectReads(selection: DomEditSelection | null, frames: number): number {
  const reads = { count: 0 };
  const iframe = document.createElement("iframe");
  const overlay = document.createElement("div");
  const doc = document.implementation.createHTMLDocument("preview");
  doc.body.innerHTML =
    '<div data-composition-id="main" data-width="1920" data-height="1080"><div id="box"></div></div>';
  Object.defineProperty(iframe, "contentDocument", { value: doc });
  for (const el of [iframe, overlay, ...Array.from(doc.querySelectorAll("div"))]) {
    const read = el.getBoundingClientRect.bind(el);
    el.getBoundingClientRect = () => (reads.count++, read());
  }
  function Host() {
    const refs = {
      iframeRef: useRef<HTMLIFrameElement | null>(iframe),
      overlayRef: useRef<HTMLDivElement | null>(overlay),
      selectionRef: useRef<DomEditSelection | null>(selection),
      activeCompositionPathRef: useRef<string | null>(null),
      groupSelectionsRef: useRef<DomEditSelection[]>([]),
      hoverSelectionRef: useRef<DomEditSelection | null>(null),
      rafPausedRef: useRef(false),
    };
    useDomEditOverlayRects(refs);
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<Host />));
  act(() => {
    for (let i = 0; i < frames; i++) {
      requestOverlayFrames();
      const batch = queued;
      queued = [];
      for (const callback of batch) callback();
    }
  });
  act(() => root.unmount());
  host.remove();
  return reads.count;
}

// fails without the fix: each frame read the iframe, overlay and composition root before checking for a selection.
it("an unselected, unhovered preview costs the frame loop no layout reads", () => {
  expect(rectReads(null, 20)).toBe(0);
});

it("a selected element still gets its box measured every frame", () => {
  expect(rectReads({ id: "box" } as unknown as DomEditSelection, 5)).toBeGreaterThan(0);
});
