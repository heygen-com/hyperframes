// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { usePlayerStore } from "../store/playerStore";
import { BeatStrip } from "./BeatStrip";
import { resolveTimelineContextElement, TimelineOverlays } from "./TimelineOverlays";
import { defaultTimelineTheme } from "./timelineTheme";

const beatActions = vi.hoisted(() => ({
  move: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("../../utils/beatEditActions", () => ({
  moveBeatCompositionTime: beatActions.move,
  deleteBeatAtCompositionTime: beatActions.remove,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const requestSeek = vi.fn();
const MUSIC_ELEMENT: TimelineElement = {
  id: "background-music",
  label: "Music",
  tag: "audio",
  src: "music.mp3",
  start: 0,
  duration: 10,
  track: 0,
  timelineRole: "music",
};

function pointerEvent(type: string, init: PointerEventInit): Event {
  if (typeof PointerEvent === "function") return new PointerEvent(type, init);
  const event = new MouseEvent(type, init);
  Object.defineProperty(event, "pointerId", { value: init.pointerId ?? 0 });
  return event;
}

function mountBeatStrip(renderTimeRange?: { start: number; end: number }) {
  const viewport = document.createElement("div");
  viewport.dataset.timelineScrollViewport = "";
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: 500 },
    clientHeight: { configurable: true, value: 300 },
    scrollWidth: { configurable: true, value: 2_000 },
    scrollHeight: { configurable: true, value: 2_000 },
  });
  viewport.getBoundingClientRect = () =>
    ({ left: 0, right: 1_000, top: 0, bottom: 500, width: 1_000, height: 500 }) as DOMRect;
  Object.assign(viewport, {
    setPointerCapture: vi.fn(),
    hasPointerCapture: vi.fn(() => true),
    releasePointerCapture: vi.fn(),
  });
  document.body.appendChild(viewport);
  const root = createRoot(viewport);
  roots.push(root);
  act(() => {
    root.render(
      <BeatStrip
        beatTimes={[1, 3]}
        beatStrengths={[0.5, 0.8]}
        pps={100}
        renderTimeRange={renderTimeRange}
      />,
    );
  });
  return { root, viewport };
}

function firstBeat(): HTMLDivElement {
  const beat = document.querySelector<HTMLDivElement>(
    '[title="Drag to move · double-click to delete"]',
  );
  if (!beat) throw new Error("Expected a beat handle");
  return beat;
}

function startBeatDrag(clientX = 100, pointerId = 1): void {
  act(() => {
    firstBeat().dispatchEvent(
      pointerEvent("pointerdown", { bubbles: true, button: 0, clientX, clientY: 100, pointerId }),
    );
  });
}

beforeEach(() => {
  beatActions.move.mockReset();
  beatActions.remove.mockReset();
  requestSeek.mockReset();
  usePlayerStore.setState({
    timelineSessionEpoch: 1,
    timelineProjectId: "project-a",
    beatDragging: false,
    requestSeek,
    elements: [MUSIC_ELEMENT],
  });
});

afterEach(() => {
  act(() => window.dispatchEvent(new Event("blur")));
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("BeatStrip gesture ownership", () => {
  it("commits once after its source row unmounts", () => {
    const { root } = mountBeatStrip();
    startBeatDrag();
    act(() => root.render(null));

    act(() => {
      window.dispatchEvent(
        pointerEvent("pointermove", {
          bubbles: true,
          clientX: 140,
          clientY: 100,
          pointerId: 1,
        }),
      );
      window.dispatchEvent(
        pointerEvent("pointerup", {
          bubbles: true,
          clientX: 140,
          clientY: 100,
          pointerId: 1,
        }),
      );
      window.dispatchEvent(
        pointerEvent("pointerup", {
          bubbles: true,
          clientX: 160,
          clientY: 100,
          pointerId: 1,
        }),
      );
    });

    expect(beatActions.move).toHaveBeenCalledExactlyOnceWith(1, 1.4);
    expect(usePlayerStore.getState().beatDragging).toBe(false);
  });

  it("includes viewport scrolling in the final beat time", () => {
    const { viewport } = mountBeatStrip();
    startBeatDrag(100);
    viewport.scrollLeft = 50;

    act(() => {
      window.dispatchEvent(
        pointerEvent("pointerup", {
          bubbles: true,
          clientX: 110,
          clientY: 100,
          pointerId: 1,
        }),
      );
    });

    expect(beatActions.move).toHaveBeenCalledExactlyOnceWith(1, 1.6);
  });

  it("cancels without mutation on pointer cancel, Escape, and project switch", () => {
    mountBeatStrip();
    startBeatDrag();
    act(() => {
      window.dispatchEvent(pointerEvent("pointercancel", { pointerId: 1 }));
      window.dispatchEvent(pointerEvent("pointerup", { clientX: 140, clientY: 100, pointerId: 1 }));
    });

    startBeatDrag();
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

    startBeatDrag();
    act(() => usePlayerStore.getState().beginTimelineSession("project-b"));
    act(() => {
      window.dispatchEvent(pointerEvent("pointerup", { clientX: 140, clientY: 100, pointerId: 1 }));
    });

    expect(beatActions.move).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().beatDragging).toBe(false);
  });

  it("cancels without mutation when the captured music source disappears", () => {
    mountBeatStrip();
    startBeatDrag();
    act(() => usePlayerStore.setState({ elements: [] }));
    act(() => {
      window.dispatchEvent(pointerEvent("pointerup", { clientX: 140, clientY: 100, pointerId: 1 }));
    });

    expect(beatActions.move).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().beatDragging).toBe(false);
  });

  it("ignores unrelated pointers and keeps the active beat rendered outside the time window", () => {
    const { root } = mountBeatStrip();
    startBeatDrag();
    act(() => {
      window.dispatchEvent(
        pointerEvent("pointermove", {
          bubbles: true,
          clientX: 150,
          clientY: 100,
          pointerId: 2,
        }),
      );
      window.dispatchEvent(
        pointerEvent("pointerup", {
          bubbles: true,
          clientX: 150,
          clientY: 100,
          pointerId: 2,
        }),
      );
      root.render(
        <BeatStrip
          beatTimes={[1, 3]}
          beatStrengths={[0.5, 0.8]}
          pps={100}
          renderTimeRange={{ start: 2.5, end: 3.5 }}
        />,
      );
    });

    expect(
      document.querySelectorAll('[title="Drag to move · double-click to delete"]'),
    ).toHaveLength(2);
    expect(beatActions.move).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(
        pointerEvent("pointerup", {
          bubbles: true,
          clientX: 150,
          clientY: 100,
          pointerId: 1,
        }),
      );
    });
    expect(beatActions.move).toHaveBeenCalledOnce();
  });

  it("does not autoscroll or mutate below the drag threshold", () => {
    const requestAnimationFrame = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    mountBeatStrip();
    startBeatDrag(990);

    act(() => {
      window.dispatchEvent(
        pointerEvent("pointermove", {
          bubbles: true,
          clientX: 991,
          clientY: 100,
          pointerId: 1,
        }),
      );
      window.dispatchEvent(
        pointerEvent("pointerup", {
          bubbles: true,
          clientX: 991,
          clientY: 100,
          pointerId: 1,
        }),
      );
    });

    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(beatActions.move).not.toHaveBeenCalled();
  });
});

describe("timeline context target ownership", () => {
  const captured: TimelineElement = {
    id: "clip-1",
    label: "Clip",
    tag: "div",
    start: 0,
    duration: 2,
    track: 0,
  };

  it("accepts only the exact selected model object from the captured project session", () => {
    expect(
      resolveTimelineContextElement({
        capturedElement: captured,
        targetSessionEpoch: 4,
        sessionEpoch: 4,
        selectedElementId: captured.id,
        elements: [captured],
      }),
    ).toBe(captured);
    expect(
      resolveTimelineContextElement({
        capturedElement: captured,
        targetSessionEpoch: 4,
        sessionEpoch: 5,
        selectedElementId: captured.id,
        elements: [captured],
      }),
    ).toBeNull();
    expect(
      resolveTimelineContextElement({
        capturedElement: captured,
        targetSessionEpoch: 4,
        sessionEpoch: 4,
        selectedElementId: "other",
        elements: [captured],
      }),
    ).toBeNull();
  });

  it("keeps an expanded child target that is selected in the captured session", () => {
    const expandedChild = {
      ...captured,
      key: "nested.html#clip-1",
      sourceFile: "nested.html",
      track: 0.5,
    };
    expect(
      resolveTimelineContextElement({
        capturedElement: expandedChild,
        targetSessionEpoch: 4,
        sessionEpoch: 4,
        selectedElementId: expandedChild.key,
        elements: [expandedChild],
      }),
    ).toBe(expandedChild);
  });

  it("removes a portaled clip menu when the same identity appears in a new project", () => {
    const setClipContextMenu = vi.fn();
    usePlayerStore.setState({
      elements: [captured],
      selectedElementId: captured.id,
      timelineSessionEpoch: 7,
      timelineProjectId: "project-a",
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    const props = {
      theme: defaultTimelineTheme,
      showShortcutHint: false,
      showPopover: false,
      rangeSelection: null,
      setShowPopover: vi.fn(),
      setRangeSelection: vi.fn(),
      kfContextMenu: null,
      setKfContextMenu: vi.fn(),
      onDeleteKeyframe: undefined,
      onDeleteAllKeyframes: undefined,
      onChangeKeyframeEase: undefined,
      onMoveKeyframeToPlayhead: undefined,
      keyframeCache: new Map(),
      clipContextMenu: { x: 10, y: 10, element: captured, sessionEpoch: 7 },
      setClipContextMenu,
      currentTime: 1,
      onSplitElement: undefined,
      pinZoomBeforeEdit: vi.fn(),
      onDeleteElement: vi.fn(),
      gapContextMenu: null,
      onDismissGapContextMenu: vi.fn(),
      onCloseTrackGap: vi.fn(),
      onCloseAllTrackGaps: vi.fn(),
      onHoverGapAction: vi.fn(),
    };
    act(() => root.render(<TimelineOverlays {...props} />));
    expect(document.body.textContent).toContain("Delete");

    act(() => {
      usePlayerStore.setState({
        elements: [{ ...captured }],
        selectedElementId: captured.id,
        timelineSessionEpoch: 8,
        timelineProjectId: "project-b",
      });
    });

    expect(setClipContextMenu).toHaveBeenCalledExactlyOnceWith(null);
    expect(document.body.textContent).not.toContain("Delete");
  });
});
