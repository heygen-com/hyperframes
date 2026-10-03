// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { usePlayerStore } from "../store/playerStore";
import { TRACK_H } from "./timelineLayout";
import { TrackHeightGrip } from "./TrackHeightGrip";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  usePlayerStore.setState({ trackHeight: TRACK_H });
  document.body.innerHTML = "";
});

function renderGrip(row: number): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  act(() => createRoot(host).render(<TrackHeightGrip row={row} />));
  const grip = host.querySelector<HTMLElement>("[data-timeline-track-height-grip]")!;
  grip.setPointerCapture = () => undefined;
  return grip;
}

function pointer(target: HTMLElement, type: string, clientY: number, buttons = 1) {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, button: 0, buttons, pointerId: 1, clientY }),
    );
  });
}

describe("TrackHeightGrip", () => {
  it("keeps the dragged edge under the pointer: the third layer's edge shares its travel three ways", () => {
    const grip = renderGrip(2);
    pointer(grip, "pointerdown", 100);
    pointer(grip, "pointermove", 130);
    expect(usePlayerStore.getState().trackHeight).toBe(TRACK_H + 10);
    pointer(grip, "pointerup", 130);
    pointer(grip, "pointermove", 400);
    expect(usePlayerStore.getState().trackHeight).toBe(TRACK_H + 10);
  });

  it("ends the drag on a move with the button up, so a lost release never resizes on hover", () => {
    const grip = renderGrip(0);
    pointer(grip, "pointerdown", 100);
    pointer(grip, "pointermove", 110, 0);
    pointer(grip, "pointermove", 140);
    expect(usePlayerStore.getState().trackHeight).toBe(TRACK_H);
  });

  it("puts every layer back to the default on a double click", () => {
    usePlayerStore.setState({ trackHeight: 30 });
    const grip = renderGrip(0);
    act(() => grip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(usePlayerStore.getState().trackHeight).toBe(TRACK_H);
  });
});
