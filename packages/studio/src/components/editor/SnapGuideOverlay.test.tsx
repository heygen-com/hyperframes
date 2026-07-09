// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SnapGuideOverlay, type SnapGuidesState } from "./SnapGuideOverlay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
let rafCallbacks: FrameRequestCallback[] = [];

function flushAnimationFrame() {
  const callbacks = rafCallbacks;
  rafCallbacks = [];
  for (const callback of callbacks) callback(0);
}

describe("SnapGuideOverlay", () => {
  beforeEach(() => {
    rafCallbacks = [];
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    };
    globalThis.cancelAnimationFrame = () => {};
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("renders snap guides only across their computed extents", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const snapGuidesRef = {
      current: {
        guides: [
          { axis: "x", position: 80, from: 40, to: 120 },
          { axis: "y", position: 140, from: 30, to: 210 },
        ],
        spacingGuides: [],
      } satisfies SnapGuidesState,
    };

    act(() => {
      root.render(
        <SnapGuideOverlay snapGuidesRef={snapGuidesRef} overlayWidth={500} overlayHeight={400} />,
      );
    });
    act(() => {
      flushAnimationFrame();
    });

    const overlay = host.querySelector("[aria-hidden='true']");
    if (!overlay) throw new Error("Expected snap overlay");
    const xGuide = overlay.children[0] as HTMLDivElement;
    const yGuide = overlay.children[1] as HTMLDivElement;

    expect(xGuide.style.left).toBe("80px");
    expect(xGuide.style.top).toBe("40px");
    expect(xGuide.style.height).toBe("80px");

    expect(yGuide.style.left).toBe("30px");
    expect(yGuide.style.top).toBe("140px");
    expect(yGuide.style.width).toBe("180px");

    act(() => {
      root.unmount();
    });
    host.remove();
  });
});
