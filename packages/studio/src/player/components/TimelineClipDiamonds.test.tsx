// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimelineClipDiamonds } from "./TimelineClipDiamonds";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function pointerEvent(type: string, init: PointerEventInit): Event {
  if (typeof PointerEvent === "function") return new PointerEvent(type, init);
  return new MouseEvent(type, init);
}

function renderDiamonds(onClickKeyframe = vi.fn()) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <TimelineClipDiamonds
        keyframesData={{
          format: "percentage",
          keyframes: [
            { percentage: 0, properties: { x: 0 } },
            { percentage: 50, properties: { x: 100 } },
          ],
        }}
        clipWidthPx={200}
        clipHeightPx={48}
        accentColor="#4ba3d2"
        isSelected
        currentPercentage={0}
        elementId="clip-1"
        selectedKeyframes={new Set()}
        onClickKeyframe={onClickKeyframe}
      />,
    );
  });
  return { host, root, onClickKeyframe };
}

describe("TimelineClipDiamonds", () => {
  it("treats primary pointerup without drag as a keyframe click", () => {
    const { host, root, onClickKeyframe } = renderDiamonds();
    const diamond = host.querySelector<HTMLButtonElement>('button[title="50%"]');
    expect(diamond).not.toBeNull();

    act(() => {
      diamond!.dispatchEvent(pointerEvent("pointerup", { bubbles: true, button: 0 }));
    });

    expect(onClickKeyframe).toHaveBeenCalledWith(50);
    act(() => root.unmount());
  });

  it("does not treat secondary pointerup as a keyframe click", () => {
    const { host, root, onClickKeyframe } = renderDiamonds();
    const diamond = host.querySelector<HTMLButtonElement>('button[title="50%"]');
    expect(diamond).not.toBeNull();

    act(() => {
      diamond!.dispatchEvent(pointerEvent("pointerup", { bubbles: true, button: 2 }));
    });

    expect(onClickKeyframe).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  // Regression: once the clip is selected, canDrag arms on every diamond
  // press. A real click's few px of mouse/trackpad jitter then resolves (via
  // the neighbour clamp) back onto ~the same position — "noop", not "move" —
  // which fell through neither branch and silently did nothing: no
  // selection, no retime. It must still count as the click it was.
  it("treats a drag-armed press that resolves to a no-op move as a click", () => {
    const onClickKeyframe = vi.fn();
    const onMoveKeyframe = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <TimelineClipDiamonds
          keyframesData={{
            format: "percentage",
            keyframes: [
              { percentage: 0, properties: { x: 0 } },
              { percentage: 50, properties: { x: 100 } },
            ],
          }}
          clipWidthPx={5000}
          clipHeightPx={48}
          accentColor="#4ba3d2"
          isSelected
          currentPercentage={0}
          elementId="clip-1"
          selectedKeyframes={new Set()}
          onClickKeyframe={onClickKeyframe}
          onMoveKeyframe={onMoveKeyframe}
        />,
      );
    });
    const diamond = host.querySelector<HTMLButtonElement>('button[title="50%"]');
    expect(diamond).not.toBeNull();

    act(() => {
      diamond!.dispatchEvent(
        pointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100 }),
      );
      // 4px of travel at a 5000px clip width is ~0.08 clip-% — above the drag
      // threshold (so resolveKeyframeDrag doesn't short-circuit to "click"
      // itself) but below the no-op epsilon once neighbour-clamped.
      diamond!.dispatchEvent(pointerEvent("pointerup", { bubbles: true, button: 0, clientX: 104 }));
    });

    expect(onClickKeyframe).toHaveBeenCalledWith(50);
    expect(onMoveKeyframe).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  // Regression: a genuine retime (drag far enough to actually move the
  // keyframe) committed the move but never selected/parked on the result —
  // the diamond it was just dragged looked exactly like one nothing happened
  // to. Select it at its NEW position too.
  it("selects the keyframe at its new position after a real drag-retime", () => {
    const onClickKeyframe = vi.fn();
    const onMoveKeyframe = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <TimelineClipDiamonds
          keyframesData={{
            format: "percentage",
            keyframes: [
              { percentage: 0, properties: { x: 0 } },
              { percentage: 50, properties: { x: 100 } },
            ],
          }}
          clipWidthPx={200}
          clipHeightPx={48}
          accentColor="#4ba3d2"
          isSelected
          currentPercentage={0}
          elementId="clip-1"
          selectedKeyframes={new Set()}
          onClickKeyframe={onClickKeyframe}
          onMoveKeyframe={onMoveKeyframe}
        />,
      );
    });
    const diamond = host.querySelector<HTMLButtonElement>('button[title="50%"]');
    expect(diamond).not.toBeNull();

    act(() => {
      diamond!.dispatchEvent(
        pointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100 }),
      );
      // 4px at a 200px clip width is 2 clip-% — well past the no-op epsilon,
      // a real retime.
      diamond!.dispatchEvent(pointerEvent("pointerup", { bubbles: true, button: 0, clientX: 104 }));
    });

    expect(onMoveKeyframe).toHaveBeenCalledWith("clip-1", 50, 52);
    expect(onClickKeyframe).toHaveBeenCalledWith(52);
    act(() => root.unmount());
  });

  // Regression: onClickKeyframe's state updates can re-render the diamond
  // button out from under the gesture before the browser auto-synthesizes the
  // "click" event that follows a button's pointerdown+pointerup. That orphaned
  // click then bubbles to the ancestor clip's onClick, which toggles selection
  // off whenever the clip is already selected — the state a diamond click
  // always happens in — so every keyframe click immediately deselected its
  // own clip. suppressClickRef lets that ancestor ignore the stray click.
  it("arms suppressClickRef synchronously on a keyframe click", () => {
    const suppressClickRef = { current: false };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <TimelineClipDiamonds
          keyframesData={{
            format: "percentage",
            keyframes: [{ percentage: 50, properties: { x: 100 } }],
          }}
          clipWidthPx={200}
          clipHeightPx={48}
          accentColor="#4ba3d2"
          isSelected
          currentPercentage={0}
          elementId="clip-1"
          selectedKeyframes={new Set()}
          onClickKeyframe={vi.fn()}
          suppressClickRef={suppressClickRef}
        />,
      );
    });
    const diamond = host.querySelector<HTMLButtonElement>('button[title="50%"]');
    expect(diamond).not.toBeNull();

    act(() => {
      diamond!.dispatchEvent(pointerEvent("pointerup", { bubbles: true, button: 0 }));
    });

    expect(suppressClickRef.current).toBe(true);
    act(() => root.unmount());
  });
});
