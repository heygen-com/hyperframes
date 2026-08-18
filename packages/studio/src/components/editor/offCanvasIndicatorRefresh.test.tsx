// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DomEditOverlay } from "./DomEditOverlay";
import {
  countScheduledFrames,
  pinWeakRefStrong,
  restoreAnimationFrameCounter,
  testDomRect as domRect,
  unpinWeakRef,
} from "./overlayLoopTestKit";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

beforeAll(pinWeakRefStrong);
afterAll(unpinWeakRef);

const INDICATOR = '[aria-label="Select off-canvas element index.html:headline:0"]';

const nativeRequestAnimationFrame = globalThis.requestAnimationFrame;

async function flushAnimationFrames(): Promise<void> {
  await new Promise<void>((resolve) => {
    nativeRequestAnimationFrame(() => nativeRequestAnimationFrame(() => resolve()));
  });
}

interface OverlayHarness {
  host: HTMLElement;
  movedElement: HTMLElement;
  cleanup: () => void;
}

// Mount DomEditOverlay over an iframe whose #headline sits at `initialLeft`, with a
// getBoundingClientRect stub that reads the element's live inline geometry (so a
// style mutation moves it) and reports the composition/overlay as 800x450 at origin.
function mountOverlayWithHeadline(initialLeft: number): OverlayHarness {
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  const host = document.createElement("div");
  document.body.append(host);
  const root: Root = createRoot(host);
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const doc = iframe.contentDocument;
  if (!doc) throw new Error("Expected iframe content document");

  doc.body.innerHTML = `
    <div data-composition-id="root" data-width="800" data-height="450">
      <div id="headline" style="position:absolute; left:${initialLeft}px; top:40px; width:100px; height:40px;">Headline</div>
    </div>
  `;
  const movedElement = doc.getElementById("headline");
  if (!movedElement) throw new Error("Expected test element");

  Element.prototype.getBoundingClientRect = function (): DOMRect {
    if (this === movedElement) {
      return domRect(
        Number.parseFloat(movedElement.style.left),
        Number.parseFloat(movedElement.style.top),
        Number.parseFloat(movedElement.style.width),
        Number.parseFloat(movedElement.style.height),
      );
    }
    return domRect(0, 0, 800, 450);
  };

  act(() => {
    root.render(
      <DomEditOverlay
        iframeRef={{ current: iframe }}
        activeCompositionPath={null}
        selection={null}
        hoverSelection={null}
        groupSelections={[]}
        onCanvasMouseDown={() => {}}
        onCanvasPointerMove={() => Promise.resolve(null)}
        onCanvasPointerLeave={() => {}}
        onSelectionChange={() => {}}
        onBlockedMove={() => {}}
        onPathOffsetCommit={() => {}}
        onGroupPathOffsetCommit={() => {}}
        onBoxSizeCommit={() => {}}
        onRotationCommit={() => {}}
      />,
    );
  });

  return {
    host,
    movedElement,
    cleanup: () => {
      act(() => root.unmount());
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      restoreAnimationFrameCounter();
      iframe.remove();
      host.remove();
    },
  };
}

describe("canvas overlay idle cost", () => {
  it("schedules no animation frames once the overlay has settled", async () => {
    const h = mountOverlayWithHeadline(760);
    try {
      await act(async () => {
        await flushAnimationFrames();
        await flushAnimationFrames();
      });
      expect(h.host.querySelector(INDICATOR)).toBeTruthy();

      // All four canvas overlay loops are mounted here (selection rects,
      // composition rect, off-canvas indicators, snap guides). Idle, none of
      // them may wake the page: this is the runtime-cost gate's idle
      // animation-frame budget, asserted where it can be debugged.
      const scheduled = countScheduledFrames();
      await act(async () => {
        await flushAnimationFrames();
        await flushAnimationFrames();
        await flushAnimationFrames();
      });

      expect(scheduled()).toBe(0);
    } finally {
      h.cleanup();
    }
  });

  it("runs nothing after unmount", async () => {
    const h = mountOverlayWithHeadline(760);
    await act(async () => {
      await flushAnimationFrames();
    });
    act(() => {
      h.movedElement.style.left = "120px";
    });
    h.cleanup();

    const scheduled = countScheduledFrames();
    await flushAnimationFrames();
    await flushAnimationFrames();
    expect(scheduled()).toBe(0);
    restoreAnimationFrameCounter();
  });
});

describe("off-canvas indicator refresh", () => {
  it("removes the indicator when an off-canvas element moves in-canvas (off->on)", async () => {
    const h = mountOverlayWithHeadline(760);
    try {
      await act(async () => {
        await flushAnimationFrames();
      });
      expect(h.host.querySelector(INDICATOR)).toBeTruthy();

      act(() => {
        h.movedElement.style.left = "120px";
      });
      await act(async () => {
        await Promise.resolve();
        await flushAnimationFrames();
      });

      expect(h.host.querySelector(INDICATOR)).toBeNull();
    } finally {
      h.cleanup();
    }
  });

  it("tracks the indicator to the new position when it stays off-canvas (off->off)", async () => {
    const h = mountOverlayWithHeadline(760);
    try {
      await act(async () => {
        await flushAnimationFrames();
      });
      const before = h.host.querySelector(INDICATOR);
      expect(before).toBeTruthy();
      const leftBefore = (before!.parentElement as HTMLElement).style.left;

      // Move further off-canvas (still outside the 800px-wide composition).
      act(() => {
        h.movedElement.style.left = "1200px";
      });
      await act(async () => {
        await Promise.resolve();
        await flushAnimationFrames();
      });

      const after = h.host.querySelector(INDICATOR);
      expect(after).toBeTruthy();
      const leftAfter = (after!.parentElement as HTMLElement).style.left;
      expect(leftAfter).not.toEqual(leftBefore);
    } finally {
      h.cleanup();
    }
  });
});
