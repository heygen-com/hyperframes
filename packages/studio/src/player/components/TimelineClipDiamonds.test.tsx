// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { usePlayerStore } from "../store/playerStore";
import { TimelineClipDiamonds, TimelineDiamondLane } from "./TimelineClipDiamonds";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  usePlayerStore.setState({ elements: [], timelineSessionEpoch: 0 });
});

const RETIME_ELEMENT: TimelineElement = {
  id: "clip-1",
  label: "Clip",
  tag: "div",
  start: 0,
  duration: 10,
  track: 0,
};

function pointerEvent(type: string, init: PointerEventInit): Event {
  const event =
    typeof PointerEvent === "function" ? new PointerEvent(type, init) : new MouseEvent(type, init);
  if (!("pointerId" in event)) {
    Object.defineProperty(event, "pointerId", { value: init.pointerId ?? 0 });
  }
  return event;
}

function createTimelineHost() {
  const host = document.createElement("div");
  host.setAttribute("data-timeline-scroll-viewport", "");
  document.body.append(host);
  return host;
}

function renderDiamonds(onClickKeyframe = vi.fn(), onShiftClickKeyframe = vi.fn()) {
  const host = createTimelineHost();
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
        clipStart={10}
        clipDuration={10}
        selectedKeyframes={new Set()}
        onClickKeyframe={onClickKeyframe}
        onShiftClickKeyframe={onShiftClickKeyframe}
      />,
    );
  });
  return { host, root, onClickKeyframe, onShiftClickKeyframe };
}

function renderRetimeLane(onMoveKeyframe = vi.fn().mockResolvedValue(true), strict = false) {
  usePlayerStore.setState({ elements: [RETIME_ELEMENT] });
  const host = createTimelineHost();
  const root = createRoot(host);
  const onClickKeyframe = vi.fn();
  const lane = (
    <TimelineDiamondLane
      keyframesData={{
        format: "percentage",
        keyframes: [
          {
            percentage: 0,
            tweenPercentage: 0,
            propertyGroup: "position",
            animationId: "anim-1",
            properties: { x: 0 },
          },
          {
            percentage: 50,
            tweenPercentage: 50,
            propertyGroup: "position",
            animationId: "anim-1",
            properties: { x: 100 },
          },
          {
            percentage: 100,
            tweenPercentage: 100,
            propertyGroup: "position",
            animationId: "anim-1",
            properties: { x: 200 },
          },
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
      groupAware
    />
  );
  act(() => {
    root.render(strict ? <React.StrictMode>{lane}</React.StrictMode> : lane);
  });
  const diamond = host.querySelector<HTMLButtonElement>('button[title="50%"]');
  expect(diamond).not.toBeNull();
  return { diamond: diamond!, host, onClickKeyframe, onMoveKeyframe, root };
}

describe("TimelineClipDiamonds", () => {
  it("gives keyframes time-based names and native keyboard selection semantics", () => {
    const { host, root, onClickKeyframe } = renderDiamonds();
    const diamond = host.querySelector<HTMLButtonElement>('button[title="50%"]')!;
    expect(diamond.getAttribute("aria-label")).toBe("Motion keyframe at 15s");
    expect(diamond.getAttribute("aria-pressed")).toBe("false");
    act(() => diamond.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })));
    expect(onClickKeyframe).toHaveBeenCalledWith(50);
    act(() => root.unmount());
  });

  it("uses Shift+Space's native click for additive keyframe selection", () => {
    const { host, root, onClickKeyframe, onShiftClickKeyframe } = renderDiamonds();
    const diamond = host.querySelector<HTMLButtonElement>('button[title="50%"]')!;
    act(() =>
      diamond.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0, shiftKey: true })),
    );
    expect(onShiftClickKeyframe).toHaveBeenCalledWith("clip-1", 50);
    expect(onClickKeyframe).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("publishes retime previews after StrictMode effect replay", () => {
    const { diamond, host, root } = renderRetimeLane(undefined, true);
    const initialLeft = diamond.style.left;
    act(() => {
      diamond.dispatchEvent(
        pointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, pointerId: 7 }),
      );
      window.dispatchEvent(
        pointerEvent("pointermove", { bubbles: true, clientX: 120, pointerId: 7 }),
      );
    });
    expect(host.querySelector<HTMLButtonElement>('button[title="50%"]')?.style.left).not.toBe(
      initialLeft,
    );
    act(() => root.unmount());
  });

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
    const host = createTimelineHost();
    const root = createRoot(host);
    act(() => {
      root.render(
        <TimelineDiamondLane
          keyframesData={{
            format: "percentage",
            keyframes: [
              {
                percentage: 0,
                tweenPercentage: 0,
                propertyGroup: "position",
                animationId: "anim-1",
                properties: { x: 0 },
              },
              {
                percentage: 50,
                tweenPercentage: 100,
                propertyGroup: "position",
                animationId: "anim-1",
                properties: { x: 100 },
              },
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
          groupAware
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

    expect(onClickKeyframe).toHaveBeenCalledWith({
      percentage: 50,
      tweenPercentage: 100,
      propertyGroup: "position",
      animationId: "anim-1",
    });
    expect(onMoveKeyframe).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  // Regression: a genuine retime (drag far enough to actually move the
  // keyframe) committed the move but never selected/parked on the result —
  // the diamond it was just dragged looked exactly like one nothing happened
  // to. Select it at its NEW position too.
  it("reselects a retimed keyframe with its post-move tween percentage", () => {
    const onClickKeyframe = vi.fn();
    const onMoveKeyframe = vi.fn().mockResolvedValue(true);
    const host = createTimelineHost();
    const root = createRoot(host);
    act(() => {
      root.render(
        <TimelineDiamondLane
          keyframesData={{
            format: "percentage",
            keyframes: [
              {
                percentage: 20,
                tweenPercentage: 0,
                propertyGroup: "position",
                animationId: "anim-1",
                properties: { x: 0 },
              },
              {
                percentage: 40,
                tweenPercentage: 50,
                propertyGroup: "position",
                animationId: "anim-1",
                properties: { x: 100 },
              },
              {
                percentage: 60,
                tweenPercentage: 100,
                propertyGroup: "position",
                animationId: "anim-1",
                properties: { x: 200 },
              },
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
          groupAware
        />,
      );
    });
    const diamond = host.querySelector<HTMLButtonElement>('button[title="40%"]');
    expect(diamond).not.toBeNull();

    act(() => {
      diamond!.dispatchEvent(
        pointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 80 }),
      );
      diamond!.dispatchEvent(pointerEvent("pointerup", { bubbles: true, button: 0, clientX: 100 }));
    });

    expect(onMoveKeyframe).toHaveBeenCalledWith(
      {
        percentage: 40,
        tweenPercentage: 50,
        propertyGroup: "position",
        animationId: "anim-1",
      },
      50,
    );
    expect(onClickKeyframe).toHaveBeenCalledWith({
      percentage: 50,
      tweenPercentage: 75,
      propertyGroup: "position",
      animationId: "anim-1",
    });
    act(() => root.unmount());
  });

  it("composes a rapid second retime from the pending position", () => {
    const onMoveKeyframe = vi.fn().mockResolvedValue(true);
    const host = createTimelineHost();
    const root = createRoot(host);
    act(() => {
      root.render(
        <TimelineDiamondLane
          keyframesData={{
            format: "percentage",
            keyframes: [
              {
                percentage: 0,
                tweenPercentage: 0,
                propertyGroup: "position",
                animationId: "anim-1",
                properties: { x: 0 },
              },
              {
                percentage: 50,
                tweenPercentage: 50,
                propertyGroup: "position",
                animationId: "anim-1",
                properties: { x: 100 },
              },
              {
                percentage: 100,
                tweenPercentage: 100,
                propertyGroup: "position",
                animationId: "anim-1",
                properties: { x: 200 },
              },
            ],
          }}
          clipWidthPx={200}
          clipHeightPx={48}
          accentColor="#4ba3d2"
          isSelected
          currentPercentage={0}
          elementId="clip-1"
          selectedKeyframes={new Set()}
          onMoveKeyframe={onMoveKeyframe}
          groupAware
        />,
      );
    });
    const diamond = host.querySelector<HTMLButtonElement>('button[title="50%"]');
    expect(diamond).not.toBeNull();

    act(() => {
      diamond!.dispatchEvent(
        pointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100 }),
      );
      diamond!.dispatchEvent(pointerEvent("pointerup", { bubbles: true, button: 0, clientX: 150 }));

      // The cache still exposes 50%, but this second +10% drag starts at the
      // pending 75% destination and must therefore land at 85%, not 60%.
      diamond!.dispatchEvent(
        pointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 150 }),
      );
      diamond!.dispatchEvent(pointerEvent("pointerup", { bubbles: true, button: 0, clientX: 170 }));
    });

    // The second move must identify the FROM keyframe by the pending (already-
    // moved) position 75%, not the stale rendered 50%; otherwise the serialized
    // mutation can't locate the keyframe the first move relocated.
    expect(onMoveKeyframe).toHaveBeenNthCalledWith(
      2,
      {
        percentage: 75,
        tweenPercentage: 75,
        propertyGroup: "position",
        animationId: "anim-1",
      },
      85,
    );

    act(() => {
      usePlayerStore.setState({ timelineSessionEpoch: 1 });
      diamond!.dispatchEvent(
        pointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100 }),
      );
      diamond!.dispatchEvent(pointerEvent("pointerup", { bubbles: true, button: 0, clientX: 120 }));
    });
    expect(onMoveKeyframe).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ percentage: 50 }),
      60,
    );
    act(() => root.unmount());
  });

  it.each([
    ["returns false", () => Promise.resolve(false)],
    ["rejects", () => Promise.reject(new Error("retime failed"))],
  ])("clears a failed pending retime when the callback %s", async (_label, settle) => {
    const onMoveKeyframe = vi.fn().mockImplementationOnce(settle).mockResolvedValue(true);
    const host = createTimelineHost();
    const root = createRoot(host);
    act(() => {
      root.render(
        <TimelineDiamondLane
          keyframesData={{
            format: "percentage",
            keyframes: [
              {
                percentage: 0,
                tweenPercentage: 0,
                propertyGroup: "position",
                animationId: "anim-1",
                properties: { x: 0 },
              },
              {
                percentage: 50,
                tweenPercentage: 50,
                propertyGroup: "position",
                animationId: "anim-1",
                properties: { x: 100 },
              },
              {
                percentage: 100,
                tweenPercentage: 100,
                propertyGroup: "position",
                animationId: "anim-1",
                properties: { x: 200 },
              },
            ],
          }}
          clipWidthPx={200}
          clipHeightPx={48}
          accentColor="#4ba3d2"
          isSelected
          currentPercentage={0}
          elementId="clip-1"
          selectedKeyframes={new Set()}
          onMoveKeyframe={onMoveKeyframe}
          groupAware
        />,
      );
    });
    const diamond = host.querySelector<HTMLButtonElement>('button[title="50%"]');
    expect(diamond).not.toBeNull();

    await act(async () => {
      diamond!.dispatchEvent(
        pointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100 }),
      );
      diamond!.dispatchEvent(pointerEvent("pointerup", { bubbles: true, button: 0, clientX: 150 }));
      await Promise.resolve();
    });

    act(() => {
      diamond!.dispatchEvent(
        pointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100 }),
      );
      diamond!.dispatchEvent(pointerEvent("pointerup", { bubbles: true, button: 0, clientX: 120 }));
    });

    expect(onMoveKeyframe).toHaveBeenNthCalledWith(
      2,
      {
        percentage: 50,
        tweenPercentage: 50,
        propertyGroup: "position",
        animationId: "anim-1",
      },
      60,
    );
    act(() => root.unmount());
  });

  it("commits once from the stable viewport after the source lane unmounts", () => {
    const { diamond, onMoveKeyframe, root } = renderRetimeLane();

    act(() => {
      diamond.dispatchEvent(
        pointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, pointerId: 7 }),
      );
      root.unmount();
      window.dispatchEvent(
        pointerEvent("pointerup", { bubbles: true, button: 0, clientX: 120, pointerId: 7 }),
      );
      window.dispatchEvent(
        pointerEvent("pointerup", { bubbles: true, button: 0, clientX: 140, pointerId: 7 }),
      );
    });

    expect(onMoveKeyframe).toHaveBeenCalledExactlyOnceWith(
      {
        percentage: 50,
        tweenPercentage: 50,
        propertyGroup: "position",
        animationId: "anim-1",
      },
      60,
    );
  });

  it("includes horizontal viewport scrolling in the retime destination", () => {
    const { diamond, host, onMoveKeyframe, root } = renderRetimeLane();

    act(() => {
      diamond.dispatchEvent(
        pointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, pointerId: 7 }),
      );
      host.scrollLeft = 20;
      window.dispatchEvent(
        pointerEvent("pointerup", { bubbles: true, button: 0, clientX: 100, pointerId: 7 }),
      );
    });

    expect(onMoveKeyframe).toHaveBeenCalledExactlyOnceWith(expect.any(Object), 60);
    act(() => root.unmount());
  });

  it("ignores another pointer and lets the owning pointer finish", () => {
    const { diamond, onMoveKeyframe, root } = renderRetimeLane();

    act(() => {
      diamond.dispatchEvent(
        pointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, pointerId: 7 }),
      );
      window.dispatchEvent(
        pointerEvent("pointerup", { bubbles: true, button: 0, clientX: 140, pointerId: 8 }),
      );
      window.dispatchEvent(
        pointerEvent("pointerup", { bubbles: true, button: 0, clientX: 120, pointerId: 7 }),
      );
    });

    expect(onMoveKeyframe).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });

  it("cancels without mutation on pointer cancel or Escape and allows the next retime", () => {
    const { diamond, onMoveKeyframe, root } = renderRetimeLane();

    act(() => {
      diamond.dispatchEvent(
        pointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, pointerId: 7 }),
      );
      window.dispatchEvent(
        pointerEvent("pointercancel", {
          bubbles: true,
          button: 0,
          clientX: 120,
          pointerId: 7,
        }),
      );
      window.dispatchEvent(
        pointerEvent("pointerup", { bubbles: true, button: 0, clientX: 120, pointerId: 7 }),
      );

      diamond.dispatchEvent(
        pointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, pointerId: 9 }),
      );
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
      window.dispatchEvent(
        pointerEvent("pointerup", { bubbles: true, button: 0, clientX: 120, pointerId: 9 }),
      );

      diamond.dispatchEvent(
        pointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, pointerId: 11 }),
      );
      window.dispatchEvent(
        pointerEvent("pointerup", { bubbles: true, button: 0, clientX: 120, pointerId: 11 }),
      );
    });

    expect(onMoveKeyframe).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });

  it("cancels on project switch or source removal without poisoning the next gesture", () => {
    const { diamond, onMoveKeyframe, root } = renderRetimeLane();

    act(() => {
      diamond.dispatchEvent(
        pointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, pointerId: 7 }),
      );
      usePlayerStore.setState({ timelineSessionEpoch: 1 });
      window.dispatchEvent(
        pointerEvent("pointerup", { bubbles: true, button: 0, clientX: 120, pointerId: 7 }),
      );

      diamond.dispatchEvent(
        pointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, pointerId: 9 }),
      );
      usePlayerStore.setState({ elements: [] });
      window.dispatchEvent(
        pointerEvent("pointerup", { bubbles: true, button: 0, clientX: 120, pointerId: 9 }),
      );

      usePlayerStore.setState({ elements: [RETIME_ELEMENT] });
      diamond.dispatchEvent(
        pointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, pointerId: 11 }),
      );
      window.dispatchEvent(
        pointerEvent("pointerup", { bubbles: true, button: 0, clientX: 120, pointerId: 11 }),
      );
    });

    expect(onMoveKeyframe).toHaveBeenCalledOnce();
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
    const host = createTimelineHost();
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

  const renderSegmentLane = (lastAmbiguous: boolean) => {
    const host = createTimelineHost();
    const root = createRoot(host);
    const onSelectSegment = vi.fn();
    const kf = (percentage: number, extra: Record<string, unknown> = {}) => ({
      percentage,
      tweenPercentage: percentage,
      propertyGroup: "position",
      animationId: "anim-1",
      properties: { x: percentage },
      ...extra,
    });
    act(() => {
      root.render(
        <TimelineDiamondLane
          keyframesData={{
            format: "percentage",
            keyframes: [
              kf(0),
              kf(50),
              kf(100, {
                collidingAnimationTargets: lastAmbiguous
                  ? [
                      { animationId: "anim-1", tweenPercentage: 100 },
                      { animationId: "anim-2", tweenPercentage: 75 },
                    ]
                  : undefined,
              }),
            ],
          }}
          clipWidthPx={200}
          clipHeightPx={48}
          accentColor="#4ba3d2"
          isSelected
          currentPercentage={0}
          elementId="clip-1"
          clipStart={10}
          clipDuration={10}
          selectedKeyframes={new Set()}
          onSelectSegment={onSelectSegment}
          groupAware
        />,
      );
    });
    return { host, onSelectSegment, root };
  };

  it("shows the inline ease button on a colliding merged segment (bulk edit)", () => {
    // Both segments (0->50, 50->100) render their ease button; the 50->100
    // segment ends on a keyframe shared by two animations and the button now
    // bulk-edits both rather than being hidden.
    const { host, root } = renderSegmentLane(true);
    expect(host.querySelectorAll("[data-keyframe-ease-segment]").length).toBe(2);
    act(() => root.unmount());
  });

  it("shows the inline ease button on single-animation merged segments", () => {
    const { host, onSelectSegment, root } = renderSegmentLane(false);
    expect(host.querySelectorAll("[data-keyframe-ease-segment]").length).toBe(2);
    const ease = host.querySelector<HTMLButtonElement>("[data-keyframe-ease-button]")!;
    expect(ease.getAttribute("aria-label")).toBe("Edit none easing after 10s");
    expect(ease.classList.contains("opacity-0")).toBe(true);
    act(() => ease.click());
    expect(onSelectSegment).toHaveBeenCalledOnce();
    expect(usePlayerStore.getState().requestedSeekTime).toBeNull();
    act(() => root.unmount());
  });

  it("hides the inline ease button on a segment with no source animation id", () => {
    // A runtime-scanned keyframe has no animationId, so there is no tween to
    // target; the segment ending on it must not render a (dead) ease button.
    const host = createTimelineHost();
    const root = createRoot(host);
    const kf = (percentage: number, animationId?: string) => ({
      percentage,
      tweenPercentage: percentage,
      propertyGroup: "position",
      ...(animationId ? { animationId } : {}),
      properties: { x: percentage },
    });
    act(() => {
      root.render(
        <TimelineDiamondLane
          keyframesData={{
            format: "percentage",
            keyframes: [kf(0, "anim-1"), kf(50, "anim-1"), kf(100)],
          }}
          clipWidthPx={200}
          clipHeightPx={48}
          accentColor="#4ba3d2"
          isSelected
          currentPercentage={0}
          elementId="clip-1"
          selectedKeyframes={new Set()}
          onSelectSegment={vi.fn()}
          groupAware
        />,
      );
    });
    expect(host.querySelectorAll("[data-keyframe-ease-segment]").length).toBe(1);
    act(() => root.unmount());
  });
});
