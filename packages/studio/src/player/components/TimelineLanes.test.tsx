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

beforeEach(() => {
  document.body.innerHTML = "";
  usePlayerStore.getState().reset();
});

function renderLanes({
  elements = [firstClip],
  selectedElementId,
  selectedElementIds = new Set<string>(),
  keyframeCache,
  onMoveKeyframe,
}: {
  elements?: TimelineElement[];
  selectedElementId: string | null;
  selectedElementIds?: Set<string>;
  keyframeCache?: Map<string, KeyframeCacheEntry>;
  onMoveKeyframe?: (elementId: string, fromClipPct: number, toClipPct: number) => void;
}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const setSelectedElementId = vi.fn((id: string | null) => {
    usePlayerStore.getState().setSelectedElementId(id);
  });
  const onSelectElement = vi.fn();
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
        shiftClickClipRef={{ current: null }}
        getPreviewElement={(element) => element}
        getTrackStyle={getTrackStyle}
        keyframeCache={keyframeCache}
        selectedKeyframes={new Set()}
        currentTime={0}
        onSelectElement={onSelectElement}
        onMoveKeyframe={onMoveKeyframe}
        onToggleTrackHidden={undefined}
        onResizeElement={undefined}
        onMoveElement={undefined}
        onRazorSplit={undefined}
        onRazorSplitAll={undefined}
      />,
    );
  });

  return { host, root, setSelectedElementId, onSelectElement };
}

function pointerEvent(type: string, init: PointerEventInit): Event {
  if (typeof PointerEvent === "function") return new PointerEvent(type, init);
  return new MouseEvent(type, init);
}

function clickClip(host: HTMLElement, id: string): void {
  const clip = host.querySelector<HTMLElement>(`[data-el-id="${id}"]`);
  if (!clip) throw new Error(`Expected timeline clip ${id}`);
  act(() => {
    clip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("TimelineLanes selection", () => {
  it("keeps an already-selected clip selected on a plain click", () => {
    usePlayerStore.getState().setSelectedElementId(firstClip.id);
    const harness = renderLanes({ selectedElementId: firstClip.id });

    clickClip(harness.host, firstClip.id);

    expect(harness.setSelectedElementId).toHaveBeenCalledWith(firstClip.id);
    expect(harness.setSelectedElementId).not.toHaveBeenCalledWith(null);
    expect(harness.onSelectElement).toHaveBeenCalledWith(firstClip);
    expect(usePlayerStore.getState().selectedElementId).toBe(firstClip.id);
    act(() => harness.root.unmount());
  });

  it("narrows a marquee selection to the clicked clip", () => {
    usePlayerStore.getState().setSelection([firstClip.id, secondClip.id], firstClip.id);
    const harness = renderLanes({
      elements: [firstClip, secondClip],
      selectedElementId: firstClip.id,
      selectedElementIds: new Set([firstClip.id, secondClip.id]),
    });

    clickClip(harness.host, secondClip.id);

    expect(harness.setSelectedElementId).toHaveBeenCalledWith(secondClip.id);
    expect(harness.onSelectElement).toHaveBeenCalledWith(secondClip);
    expect([...usePlayerStore.getState().selectedElementIds]).toEqual([secondClip.id]);
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
    expect(harness.onSelectElement).toHaveBeenCalledWith(firstClip);
    expect(harness.onSelectElement).toHaveBeenCalledTimes(1);

    act(() => {
      diamond!.dispatchEvent(pointerEvent("pointerup", { bubbles: true, button: 0, clientX: 54 }));
    });

    expect(onMoveKeyframe).toHaveBeenCalledWith(firstClip.id, 50, 54);
    expect(onMoveKeyframe).toHaveBeenCalledTimes(1);
    expect([...usePlayerStore.getState().selectedElementIds]).toEqual([firstClip.id]);
    act(() => harness.root.unmount());
  });
});
