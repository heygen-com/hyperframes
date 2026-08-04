// @vitest-environment happy-dom

import React, { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimelineLanes } from "./TimelineLanes";
import { getTrackStyle } from "./timelineIcons";
import { defaultTimelineTheme } from "./timelineTheme";
import { TRACK_H, getTimelineRowGeometry } from "./timelineLayout";
import { createTimelineClipIndex } from "../lib/timelineClipIndex";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import type { MultiDragPreviewInput } from "./timelineMultiDragPreview";
import type { TimelineEditCallbacks } from "./timelineCallbacks";
import type { DraggedClipState, BlockedClipState } from "./useTimelineClipDrag";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  usePlayerStore.getState().reset();
});

/** The z-order sort keys really are fractional: a clip nudged between two lanes
 *  lands on the midpoint. These are the values that used to reach aria-label. */
const TRACK_A = 1 / 6;
const TRACK_B = 0.5;

function element(id: string, track: number): TimelineElement {
  return { id, label: id, tag: "div", start: 0, duration: 2, track };
}

function positionTween(id: string): GsapAnimation {
  return {
    id: `${id}-tween`,
    targetSelector: `#${id}`,
    method: "to",
    position: 0,
    duration: 2,
    properties: {},
    propertyGroup: "position",
    keyframes: {
      format: "percentage",
      keyframes: [
        { percentage: 0, properties: { x: 0 } },
        { percentage: 100, properties: { x: 100 } },
      ],
    },
  };
}

interface RenderLanesOptions {
  elements?: TimelineElement[];
  animations?: Map<string, GsapAnimation[]>;
  expandedClipIds?: string[];
  selectedElementIds?: Set<string>;
  multiDragPreview?: MultiDragPreviewInput | null;
  draggedClip?: DraggedClipState | null;
  onToggleTrackHidden?: TimelineEditCallbacks["onToggleTrackHidden"];
  onContextMenuLane?: (e: React.MouseEvent, track: number, time: number) => void;
}

function renderLanes(options: RenderLanesOptions = {}): {
  host: HTMLDivElement;
  root: Root;
  rerender: (next: RenderLanesOptions) => void;
} {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = (next: RenderLanesOptions) => {
    const elements = next.elements ?? [element("clip-a", TRACK_A)];
    const gsapAnimations = next.animations ?? new Map<string, GsapAnimation[]>();
    const displayTrackOrder = [...new Set(elements.map((el) => el.track))].sort((a, b) => a - b);
    const tracks: [number, TimelineElement[]][] = displayTrackOrder.map((track) => [
      track,
      elements.filter((el) => el.track === track),
    ]);
    const laneCounts = new Map(
      elements.map((el) => [el.id, (gsapAnimations.get(el.id) ?? []).length]),
    );
    const rowHeights = displayTrackOrder.map(() => TRACK_H);
    act(() => {
      usePlayerStore.setState({ expandedClipIds: new Set(next.expandedClipIds ?? []) });
      root.render(
        <TimelineLanes
          pps={100}
          contentOrigin={232}
          contentGutter={32}
          trackContentWidth={800}
          theme={defaultTimelineTheme}
          displayTrackOrder={displayTrackOrder}
          rowHeights={rowHeights}
          rowGeometry={getTimelineRowGeometry(rowHeights)}
          virtualRows={displayTrackOrder.map((_, index) => ({ index, rowKey: index }))}
          rowsVirtualized={false}
          clipIndex={createTimelineClipIndex(tracks)}
          renderTimeRange={{ start: 0, end: Number.POSITIVE_INFINITY }}
          pinnedClipIdentities={new Set()}
          trackOrder={displayTrackOrder}
          tracks={tracks}
          trackStyles={new Map()}
          laneCounts={laneCounts}
          selectedElementId={null}
          selectedElementIds={next.selectedElementIds ?? new Set()}
          hoveredClip={null}
          draggedClip={next.draggedClip ?? null}
          draggedElement={null}
          multiDragPreview={next.multiDragPreview ?? null}
          blockedClipRef={createRef<BlockedClipState | null>()}
          suppressClickRef={{ current: false }}
          scrollRef={createRef<HTMLDivElement>()}
          setHoveredClip={vi.fn()}
          setShowPopover={vi.fn()}
          setRangeSelection={vi.fn()}
          setResizingClip={vi.fn()}
          setDraggedClip={vi.fn()}
          setSelectedElementId={vi.fn()}
          shiftClickClipRef={createRef()}
          getPreviewElement={(el) => el}
          getTrackStyle={getTrackStyle}
          gsapAnimations={gsapAnimations}
          selectedKeyframes={new Set()}
          currentTime={0}
          onContextMenuLane={next.onContextMenuLane}
          onToggleTrackHidden={next.onToggleTrackHidden}
          onTogglePropertyGroupKeyframe={vi.fn()}
          onResizeElement={vi.fn()}
          onMoveElement={vi.fn()}
          onRazorSplit={vi.fn()}
          onRazorSplitAll={vi.fn()}
        />,
      );
    });
  };
  render(options);
  return { host, root, rerender: render };
}

function visibilityLabels(host: HTMLElement): (string | null)[] {
  return Array.from(host.querySelectorAll("button[aria-label^='Hide track ']")).map((button) =>
    button.getAttribute("aria-label"),
  );
}

describe("TimelineLanes track numbering", () => {
  // Screen readers literally announced "Hide track 0.16666666666666666".
  it("numbers tracks contiguously from 1 regardless of the fractional sort keys", () => {
    const view = renderLanes({
      elements: [element("clip-a", TRACK_A), element("clip-b", TRACK_B)],
    });

    expect(visibilityLabels(view.host)).toEqual(["Hide track 1", "Hide track 2"]);
    expect(view.host.querySelectorAll("[data-timeline-row]")).toHaveLength(2);
    expect(view.host.innerHTML).not.toContain("0.16666666666666666");
    act(() => view.root.unmount());
  });

  it("hands the visibility toggle the real track key, not the display index", () => {
    const onToggleTrackHidden = vi.fn();
    const view = renderLanes({
      elements: [element("clip-a", TRACK_A), element("clip-b", TRACK_B)],
      onToggleTrackHidden,
    });

    const second = view.host.querySelector<HTMLButtonElement>('button[aria-label="Hide track 2"]');
    act(() => second?.click());

    expect(onToggleTrackHidden).toHaveBeenCalledWith(TRACK_B, true);
    act(() => view.root.unmount());
  });

  // The gap menu inserts at the track it is given, so a display index here would
  // drop the new clip on the wrong lane.
  it("hands the lane context menu the real track key, not the display index", () => {
    const onContextMenuLane = vi.fn();
    const view = renderLanes({
      elements: [element("clip-a", TRACK_A), element("clip-b", TRACK_B)],
      onContextMenuLane,
    });

    // Row children: [sticky header column, time-mapped track content]. The rows
    // sit inside the lanes list, which is what carries the virtualization
    // positioning context.
    const rows = Array.from(view.host.querySelectorAll('[role="listitem"]'));
    const secondTrackContent = rows[1]?.children.item(1);
    act(() => {
      secondTrackContent?.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 100 }),
      );
    });

    expect(onContextMenuLane).toHaveBeenCalledOnce();
    expect(onContextMenuLane.mock.calls[0]?.[1]).toBe(TRACK_B);
    act(() => view.root.unmount());
  });
});

describe("TimelineLanes disclosure target", () => {
  const ANIMATIONS = new Map([["clip-a", [positionTween("clip-a")]]]);

  function ariaControlsTarget(host: HTMLElement): HTMLElement | null {
    const caret = host.querySelector("button[aria-controls]");
    const id = caret?.getAttribute("aria-controls");
    return id ? host.querySelector<HTMLElement>(`#${id}`) : null;
  }

  // aria-controls used to name a div in the sticky label column: it computed to
  // 0x0 and held no diamonds at all.
  it("resolves the caret's aria-controls to an element holding the property lanes", () => {
    const view = renderLanes({ animations: ANIMATIONS, expandedClipIds: ["clip-a"] });
    const target = ariaControlsTarget(view.host);

    expect(target).not.toBeNull();
    expect(target?.querySelectorAll("[data-timeline-property-lane]").length).toBeGreaterThan(0);
    act(() => view.root.unmount());
  });

  it("still resolves the caret's aria-controls while the layer is collapsed", () => {
    const view = renderLanes({ animations: ANIMATIONS, expandedClipIds: [] });
    const target = ariaControlsTarget(view.host);

    expect(target).not.toBeNull();
    expect(target?.querySelectorAll("[data-timeline-property-lane]")).toHaveLength(0);
    act(() => view.root.unmount());
  });

  // Two timelines on one page (a mini-timeline in a modal beside the main one)
  // both minted `timeline-lanes-track-0`, so every caret's aria-controls
  // resolved to whichever instance mounted first.
  it("mints lane ids that do not collide with a second TimelineLanes on the page", () => {
    const first = renderLanes({ animations: ANIMATIONS, expandedClipIds: ["clip-a"] });
    const second = renderLanes({ animations: ANIMATIONS, expandedClipIds: ["clip-a"] });

    const idsFor = (host: HTMLElement) =>
      Array.from(host.querySelectorAll("button[aria-controls]")).map((caret) =>
        caret.getAttribute("aria-controls"),
      );
    const firstIds = idsFor(first.host);
    const secondIds = idsFor(second.host);

    expect(firstIds.length).toBeGreaterThan(0);
    expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);
    // Still a legal CSS id selector: the aria-controls lookups above use `#id`.
    for (const id of [...firstIds, ...secondIds]) {
      expect(id).toMatch(/^[A-Za-z][\w-]*$/);
    }
    act(() => first.root.unmount());
    act(() => second.root.unmount());
  });

  // The passenger branch wraps [clip, lanes] in a transformed div that re-renders
  // on every pointer move. An unstable key there remounts the lanes and drops the
  // in-flight drag.
  it("does not remount the lanes while a multi-clip drag slides the formation", () => {
    const elements = [element("clip-a", TRACK_A), element("clip-b", TRACK_A)];
    const selectedElementIds = new Set(["clip-a", "clip-b"]);
    const preview = (draggedPreviewStart: number): MultiDragPreviewInput => ({
      dragStarted: true,
      draggedKey: "clip-b",
      draggedOriginStart: 0,
      draggedPreviewStart,
      selectedKeys: selectedElementIds,
    });
    const view = renderLanes({
      elements,
      animations: ANIMATIONS,
      expandedClipIds: ["clip-a"],
      selectedElementIds,
      multiDragPreview: preview(0.25),
    });

    const before = ariaControlsTarget(view.host);
    const beforeLane = before?.querySelector("[data-timeline-property-lane]");
    expect(before).not.toBeNull();
    expect(beforeLane).not.toBeNull();

    view.rerender({
      elements,
      animations: ANIMATIONS,
      expandedClipIds: ["clip-a"],
      selectedElementIds,
      multiDragPreview: preview(0.75),
    });

    // Node identity, not just presence: a remount replaces these nodes.
    expect(ariaControlsTarget(view.host)).toBe(before);
    expect(before?.querySelector("[data-timeline-property-lane]")).toBe(beforeLane);
    act(() => view.root.unmount());
  });
});
