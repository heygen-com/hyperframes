// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  usePlayerStore,
  type KeyframeCacheEntry,
  type TimelineElement,
} from "../store/playerStore";
import { TimelineLanes } from "./TimelineLanes";
import { getTrackStyle } from "./timelineIcons";
import { defaultTimelineTheme } from "./timelineTheme";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

const firstClip: TimelineElement = {
  id: "clip-1",
  tag: "div",
  start: 0,
  duration: 1,
  track: 0,
};

const secondClip: TimelineElement = {
  id: "clip-2",
  tag: "div",
  start: 1,
  duration: 1,
  track: 0,
};

const laterClip: TimelineElement = {
  id: "clip-later",
  tag: "div",
  start: 5,
  duration: 2,
  track: 0,
};

beforeEach(() => {
  document.body.innerHTML = "";
  usePlayerStore.getState().reset();
});

function renderLanes({
  elements = [firstClip],
  selectedElementId,
  selectedElementIds = new Set<string>(),
  keyframeCache,
  currentTime = 0,
  onSeek = vi.fn(),
  onMoveKeyframe,
}: {
  elements?: TimelineElement[];
  selectedElementId: string | null;
  selectedElementIds?: Set<string>;
  keyframeCache?: Map<string, KeyframeCacheEntry>;
  currentTime?: number;
  onSeek?: (time: number) => void;
  onMoveKeyframe?: (elementId: string, fromClipPct: number, toClipPct: number) => void;
}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const shiftClickClipRef: React.RefObject<{
    element: TimelineElement;
    anchorX: number;
    anchorY: number;
  } | null> = { current: null };
  const setSelectedElementId = vi.fn((id: string | null) => {
    usePlayerStore.getState().setSelectedElementId(id);
  });
  const trackStyle = getTrackStyle("div");

  act(() => {
    root.render(
      <TimelineLanes
        pps={100}
        trackContentWidth={500}
        theme={defaultTimelineTheme}
        displayTrackOrder={[0]}
        trackOrder={[0]}
        tracks={[[0, elements]]}
        trackStyles={new Map([[0, trackStyle]])}
        selectedElementId={selectedElementId}
        selectedElementIds={selectedElementIds}
        hoveredClip={null}
        draggedClip={null}
        draggedElement={null}
        multiDragPreview={null}
        blockedClipRef={{ current: null }}
        suppressClickRef={{ current: false }}
        scrollRef={React.createRef<HTMLDivElement>()}
        setHoveredClip={vi.fn()}
        setShowPopover={vi.fn()}
        setRangeSelection={vi.fn()}
        setResizingClip={vi.fn()}
        setDraggedClip={vi.fn()}
        setSelectedElementId={setSelectedElementId}
        syncClipDragAutoScroll={vi.fn()}
        shiftClickClipRef={shiftClickClipRef}
        getPreviewElement={(element) => element}
        getTrackStyle={getTrackStyle}
        keyframeCache={keyframeCache}
        selectedKeyframes={new Set()}
        currentTime={currentTime}
        onSeek={onSeek}
        onMoveKeyframe={onMoveKeyframe}
        onToggleTrackHidden={undefined}
        onResizeElement={undefined}
        onMoveElement={undefined}
        onRazorSplit={undefined}
        onRazorSplitAll={undefined}
      />,
    );
  });

  return { host, root, setSelectedElementId, onSeek, shiftClickClipRef };
}

function pointerEvent(type: string, init: PointerEventInit): Event {
  if (typeof PointerEvent === "function") return new PointerEvent(type, init);
  return new MouseEvent(type, init);
}

function clickClip(host: HTMLElement, id: string, shiftKey = false): boolean {
  const clip = host.querySelector<HTMLElement>(`[data-el-id="${id}"]`);
  if (!clip) throw new Error(`Expected timeline clip ${id}`);
  const pointerDown = pointerEvent("pointerdown", { bubbles: true, button: 0, shiftKey });
  const stopPropagation = vi.spyOn(pointerDown, "stopPropagation");
  act(() => {
    clip.dispatchEvent(pointerDown);
    clip.dispatchEvent(pointerEvent("pointerup", { bubbles: true, button: 0, shiftKey }));
    clip.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey }));
  });
  return stopPropagation.mock.calls.length > 0;
}

describe("TimelineLanes selection", () => {
  it("seeks to a clicked clip when the playhead is before its window", () => {
    const harness = renderLanes({
      elements: [laterClip],
      selectedElementId: null,
      currentTime: 0,
    });

    clickClip(harness.host, laterClip.id);

    expect(harness.onSeek).toHaveBeenCalledWith(laterClip.start);
    expect(harness.setSelectedElementId).toHaveBeenCalledWith(laterClip.id);
    act(() => harness.root.unmount());
  });

  it("does not seek when the playhead is inside the clicked clip window", () => {
    const harness = renderLanes({
      selectedElementId: null,
      currentTime: 0.5,
    });

    clickClip(harness.host, firstClip.id);

    expect(harness.onSeek).not.toHaveBeenCalled();
    expect(harness.setSelectedElementId).toHaveBeenCalledWith(firstClip.id);
    act(() => harness.root.unmount());
  });

  it("does not seek when reclicking a selected clip that contains the playhead", () => {
    usePlayerStore.getState().setSelectedElementId(firstClip.id);
    const harness = renderLanes({
      selectedElementId: firstClip.id,
      currentTime: 0.5,
    });

    clickClip(harness.host, firstClip.id);

    expect(harness.onSeek).not.toHaveBeenCalled();
    expect(harness.setSelectedElementId).toHaveBeenCalledWith(firstClip.id);
    act(() => harness.root.unmount());
  });

  it("seeks to an off-window clip when selecting its keyframe diamond", () => {
    const harness = renderLanes({
      elements: [laterClip],
      selectedElementId: null,
      currentTime: 0,
      onMoveKeyframe: vi.fn(),
      keyframeCache: new Map([
        [
          laterClip.id,
          {
            format: "percentage",
            keyframes: [
              { percentage: 0, properties: { x: 0 } },
              { percentage: 50, properties: { x: 100 } },
            ],
          },
        ],
      ]),
    });
    const diamond = harness.host.querySelector<HTMLButtonElement>('button[title="50%"]');
    expect(diamond).not.toBeNull();

    act(() => {
      diamond!.dispatchEvent(
        pointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 50 }),
      );
    });

    expect(harness.onSeek).toHaveBeenCalledWith(laterClip.start);
    expect(harness.setSelectedElementId).toHaveBeenCalledWith(laterClip.id);
    act(() => harness.root.unmount());
  });

  it("writes a plain clip click to store selection only", () => {
    usePlayerStore.getState().setSelectedElementId(firstClip.id);
    const harness = renderLanes({ selectedElementId: firstClip.id });

    clickClip(harness.host, firstClip.id);

    expect(harness.setSelectedElementId).toHaveBeenCalledWith(firstClip.id);
    expect(harness.setSelectedElementId).not.toHaveBeenCalledWith(null);
    expect(usePlayerStore.getState().selectedElementId).toBe(firstClip.id);
    act(() => harness.root.unmount());
  });

  it("narrows a marquee selection in the store to the clicked clip", () => {
    usePlayerStore.getState().setSelection([firstClip.id, secondClip.id], firstClip.id);
    const harness = renderLanes({
      elements: [firstClip, secondClip],
      selectedElementId: firstClip.id,
      selectedElementIds: new Set([firstClip.id, secondClip.id]),
    });

    clickClip(harness.host, secondClip.id);

    expect(harness.setSelectedElementId).toHaveBeenCalledWith(secondClip.id);
    expect([...usePlayerStore.getState().selectedElementIds]).toEqual([secondClip.id]);
    act(() => harness.root.unmount());
  });

  it("adds an unselected clip with Shift-click without arming clip range selection", () => {
    usePlayerStore.getState().setSelection([firstClip.id], firstClip.id);
    const harness = renderLanes({
      elements: [firstClip, secondClip],
      selectedElementId: firstClip.id,
      selectedElementIds: new Set([firstClip.id]),
    });

    const stoppedPointerDown = clickClip(harness.host, secondClip.id, true);

    const state = usePlayerStore.getState();
    expect(state.selectedElementId).toBe(firstClip.id);
    expect(state.selectedElementIds).toEqual(new Set([firstClip.id, secondClip.id]));
    expect(harness.shiftClickClipRef.current).toBeNull();
    expect(stoppedPointerDown).toBe(true);
    act(() => harness.root.unmount());
  });

  it("removes a selected clip with Shift-click and keeps a remaining anchor", () => {
    usePlayerStore.getState().setSelection([firstClip.id, secondClip.id], firstClip.id);
    const harness = renderLanes({
      elements: [firstClip, secondClip],
      selectedElementId: firstClip.id,
      selectedElementIds: new Set([firstClip.id, secondClip.id]),
    });

    clickClip(harness.host, firstClip.id, true);

    const state = usePlayerStore.getState();
    expect(state.selectedElementId).toBe(secondClip.id);
    expect(state.selectedElementIds).toEqual(new Set([secondClip.id]));
    expect(harness.shiftClickClipRef.current).toBeNull();
    act(() => harness.root.unmount());
  });

  it("clears selection when Shift-click removes the last selected clip", () => {
    usePlayerStore.getState().setSelection([firstClip.id], firstClip.id);
    const harness = renderLanes({
      selectedElementId: firstClip.id,
      selectedElementIds: new Set([firstClip.id]),
    });

    clickClip(harness.host, firstClip.id, true);

    const state = usePlayerStore.getState();
    expect(state.selectedElementId).toBeNull();
    expect(state.selectedElementIds.size).toBe(0);
    act(() => harness.root.unmount());
  });

  it("selects an unselected clip and retimes its keyframe in one drag", () => {
    usePlayerStore.getState().setSelectedElementId(secondClip.id);
    const onMoveKeyframe = vi.fn();
    const harness = renderLanes({
      elements: [firstClip, secondClip],
      selectedElementId: secondClip.id,
      selectedElementIds: new Set([secondClip.id]),
      keyframeCache: new Map([
        [
          firstClip.id,
          {
            format: "percentage",
            keyframes: [
              { percentage: 0, properties: { x: 0 } },
              { percentage: 50, properties: { x: 100 } },
            ],
          },
        ],
      ]),
      onMoveKeyframe,
    });
    const diamond = harness.host.querySelector<HTMLButtonElement>('button[title="50%"]');
    expect(diamond).not.toBeNull();

    act(() => {
      diamond!.dispatchEvent(
        pointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 50 }),
      );
    });
    expect(harness.setSelectedElementId).toHaveBeenCalledWith(firstClip.id);
    expect(harness.setSelectedElementId).toHaveBeenCalledTimes(1);

    act(() => {
      diamond!.dispatchEvent(pointerEvent("pointerup", { bubbles: true, button: 0, clientX: 54 }));
    });

    expect(onMoveKeyframe).toHaveBeenCalledWith(firstClip.id, 50, 54);
    expect(onMoveKeyframe).toHaveBeenCalledTimes(1);
    expect([...usePlayerStore.getState().selectedElementIds]).toEqual([firstClip.id]);
    act(() => harness.root.unmount());
  });
});
