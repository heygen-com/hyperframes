// @vitest-environment happy-dom
import React, { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OverlayRect } from "./domEditOverlayGeometry";
import { useDomEditOverlayRects } from "./useDomEditOverlayRects";

vi.mock("./overlayFrameLoop", () => ({ subscribeOverlayFrame: () => () => {} }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rect = (left: number, top: number, width = 200, height = 100): OverlayRect => ({
  left,
  top,
  width,
  height,
  editScaleX: 1,
  editScaleY: 1,
});

function mountRects() {
  const chrome = document.createElement("div");
  let renders = 0;
  let api!: ReturnType<typeof useDomEditOverlayRects>;
  function Host() {
    renders += 1;
    api = useDomEditOverlayRects({
      iframeRef: useRef(null),
      overlayRef: useRef(null),
      selectionRef: useRef(null),
      activeCompositionPathRef: useRef(null),
      groupSelectionsRef: useRef([]),
      hoverSelectionRef: useRef(null),
      rafPausedRef: useRef(true),
      chromeRef: useRef(chrome),
    });
    return null;
  }
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<Host />));
  return {
    chrome,
    api: () => api,
    renders: () => renders,
    unmount: () => act(() => root.unmount()),
  };
}

const vars = (el: HTMLElement) =>
  ["--hf-sel-x", "--hf-sel-y", "--hf-sel-w", "--hf-sel-h"].map((k) => el.style.getPropertyValue(k));

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useDomEditOverlayRects gesture preview", () => {
  it("moves the chrome by its variables, with no render of the overlay", () => {
    const h = mountRects();
    act(() => h.api().setOverlayRect(rect(10, 20)));
    const rendersAfterCommit = h.renders();

    act(() => h.api().previewOverlayRect(rect(40, 60, 260, 130)));

    expect(h.renders()).toBe(rendersAfterCommit);
    expect(vars(h.chrome)).toEqual(["40px", "60px", "260px", "130px"]);
    expect(h.api().overlayRectRef.current).toEqual(rect(40, 60, 260, 130));
    h.unmount();
  });

  it("puts the chrome back when the gesture settles on the rect already committed", () => {
    const h = mountRects();
    act(() => h.api().setOverlayRect(rect(10, 20)));
    act(() => h.api().previewOverlayRect(rect(40, 60)));

    // A cancelled drag: the measured rect equals the state, so React writes nothing itself.
    act(() => h.api().setOverlayRect(rect(10, 20)));

    expect(vars(h.chrome)).toEqual(["10px", "20px", "200px", "100px"]);
    h.unmount();
  });

  it("hands the draft to subscribers until the next commit", () => {
    const h = mountRects();
    const seen: Array<OverlayRect | null> = [];
    const stop = h
      .api()
      .overlayRectDraft.subscribe(() => seen.push(h.api().overlayRectDraft.get()));
    act(() => h.api().previewOverlayRect(rect(40, 60)));
    act(() => h.api().setOverlayRect(rect(41, 61)));

    expect(seen).toEqual([rect(40, 60), null]);
    stop();
    h.unmount();
  });
});
