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
import { buildTimelineLogicalRows } from "./timelineKeyboardNavigation";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import type { MultiDragPreviewInput } from "./timelineMultiDragPreview";
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

/** Every string a screen reader or a sighted user actually reads. */
function visibleText(host: HTMLElement): string {
  return host.textContent ?? "";
}

function ariaLabels(host: HTMLElement): string {
  return Array.from(host.querySelectorAll("[aria-label]"))
    .map((el) => el.getAttribute("aria-label") ?? "")
    .join(" ");
}

function element(id: string, track: number): TimelineElement {
  return { id, label: id, tag: "div", start: 0, duration: 2, track };
}

interface RenderLanesOptions {
  elements?: TimelineElement[];
  animations?: Map<string, GsapAnimation[]>;
  selectedElementIds?: Set<string>;
  multiDragPreview?: MultiDragPreviewInput | null;
  draggedClip?: DraggedClipState | null;
  onToggleTrackHidden?: (
    track: number,
    hidden: boolean,
    displayNumber?: number | null,
  ) => void | Promise<void>;
  onContextMenuLane?: (e: React.MouseEvent, track: number, time: number) => void;
  hoveredClip?: string | null;
  renderClipContent?: React.ComponentProps<typeof TimelineLanes>["renderClipContent"];
  snapGuide?: { time: number; type: "beat" | "clip-edge" | "playhead" } | null;
}

function renderLanes(options: RenderLanesOptions = {}): {
  host: HTMLDivElement;
  root: Root;
  rerender: (next: RenderLanesOptions) => void;
  setSelectedElementId: ReturnType<typeof vi.fn>;
  onSelectElement: ReturnType<typeof vi.fn>;
} {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const setSelectedElementId = vi.fn();
  const onSelectElement = vi.fn();
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
          focusedTargetId={null}
          logicalRows={buildTimelineLogicalRows({
            tracks,
            displayTrackOrder,
            laneCounts,
            selectedElementId: null,
            selectedElementIds: next.selectedElementIds ?? new Set(),
            collapsedGroupIds: new Set(),
            expandedLaneOwnerIds: new Set(),
            groups: [],
            trackGroupOf: new Map(),
          })}
          clipIndex={createTimelineClipIndex(tracks)}
          renderTimeRange={{ start: 0, end: Number.POSITIVE_INFINITY }}
          visibleTimeRange={{ start: 0, end: Number.POSITIVE_INFINITY }}
          pinnedClipIdentities={new Set()}
          trackOrder={displayTrackOrder}
          tracks={tracks}
          trackStyles={new Map()}
          groups={[]}
          laneCounts={laneCounts}
          selectedElementId={null}
          selectedElementIds={next.selectedElementIds ?? new Set()}
          hoveredClip={next.hoveredClip ?? null}
          renderClipContent={next.renderClipContent}
          draggedClip={next.draggedClip ?? null}
          draggedElement={null}
          snapGuide={next.snapGuide ?? null}
          multiDragPreview={next.multiDragPreview ?? null}
          blockedClipRef={createRef<BlockedClipState | null>()}
          suppressClickRef={{ current: false }}
          scrollRef={createRef<HTMLDivElement>()}
          setHoveredClip={vi.fn()}
          setShowPopover={vi.fn()}
          setRangeSelection={vi.fn()}
          setResizingClip={vi.fn()}
          setDraggedClip={vi.fn()}
          setSelectedElementId={setSelectedElementId}
          shiftClickClipRef={createRef()}
          getPreviewElement={(el) => el}
          getTrackStyle={getTrackStyle}
          gsapAnimations={gsapAnimations}
          selectedKeyframes={new Set()}
          currentTime={0}
          onContextMenuLane={next.onContextMenuLane}
          onToggleTrackHidden={next.onToggleTrackHidden}
          onResizeElement={vi.fn()}
          onMoveElement={vi.fn()}
          onSelectElement={onSelectElement}
          onRazorSplit={vi.fn()}
          onRazorSplitAll={vi.fn()}
        />,
      );
    });
  };
  render(options);
  return { host, root, rerender: render, setSelectedElementId, onSelectElement };
}

function visibilityLabels(host: HTMLElement): (string | null)[] {
  return Array.from(host.querySelectorAll("button[aria-label^='Hide track ']")).map((button) =>
    button.getAttribute("aria-label"),
  );
}

/** The beat guide's own highlight div, keyed by the green glow every other beat lacks. */
function beatHighlight(host: HTMLElement): HTMLElement | undefined {
  return Array.from(host.querySelectorAll("div")).find((div) =>
    (div.style.boxShadow ?? "").includes("34,197,94"),
  );
}

describe("TimelineLanes beat guide", () => {
  it("draws the beat highlight from snapGuide, not from the stale draggedClip prop", () => {
    const view = renderLanes({
      elements: [element("clip-a", TRACK_A)],
      snapGuide: { time: 1.5, type: "beat" },
    });

    expect(beatHighlight(view.host)?.style.left).toBe("150px");
    act(() => view.root.unmount());
  });

  it("clears the highlight once the trim it belonged to ends", () => {
    const view = renderLanes({
      elements: [element("clip-a", TRACK_A)],
      snapGuide: { time: 1.5, type: "beat" },
    });
    view.rerender({ elements: [element("clip-a", TRACK_A)], snapGuide: null });

    expect(beatHighlight(view.host)).toBeUndefined();
    act(() => view.root.unmount());
  });
});

describe("TimelineLanes track numbering", () => {
  // Screen readers literally announced "Hide track 0.16666666666666666".
  it("numbers tracks contiguously from 1 regardless of the fractional sort keys", () => {
    const view = renderLanes({
      elements: [element("clip-a", TRACK_A), element("clip-b", TRACK_B)],
    });

    expect(visibilityLabels(view.host)).toEqual(["Hide track 1", "Hide track 2"]);
    expect(view.host.querySelectorAll("[data-timeline-row]")).toHaveLength(2);
    // Only what a user reads. The fractional key still identifies the row in
    // `id` / `data-` attributes, which is exactly where an opaque sort key
    // belongs.
    expect(visibleText(view.host)).not.toContain("0.16666666666666666");
    expect(ariaLabels(view.host)).not.toContain("0.16666666666666666");
    act(() => view.root.unmount());
  });

  it("hands the visibility toggle the real track key, not the display index", () => {
    const onToggleTrackHidden = vi.fn();
    const view = renderLanes({
      elements: [element("clip-a", TRACK_A), element("clip-b", TRACK_B)],
      onToggleTrackHidden: (track, hidden, displayNumber) => {
        onToggleTrackHidden(track, hidden, displayNumber);
      },
    });

    const second = view.host.querySelector<HTMLButtonElement>('button[aria-label="Hide track 2"]');
    act(() => second?.click());

    // Both, and they are different numbers: the real key acts, the display row
    // is what the undo-history label must announce (see `onToggleTrackHidden`).
    expect(onToggleTrackHidden).toHaveBeenCalledWith(TRACK_B, true, 2);
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

    // The lane's own content cell: the track row's second child, after the
    // sticky header column.
    const secondTrackContent = view.host
      .querySelectorAll("[data-timeline-row]")[1]
      ?.querySelector('[role="row"]')
      ?.children.item(1);
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

describe("TimelineLanes audio disclosure", () => {
  it("keeps a keyframed audio lane collapsed until its owner is expanded", () => {
    const audio = element("audio-clip", TRACK_A);
    audio.tag = "audio";
    audio.automation = JSON.stringify({
      version: 1,
      lanes: [{ target: "volume", points: [{ t: 0, v: 1 }] }],
    });
    const view = renderLanes({ elements: [audio] });

    expect(
      view.host.querySelector('button[aria-label^="Show "][aria-label$=" lanes"]'),
    ).not.toBeNull();
    expect(view.host.querySelectorAll("[data-automation-lane-label]")).toHaveLength(0);

    act(() => {
      view.host
        .querySelector<HTMLButtonElement>('button[aria-label^="Show "][aria-label$=" lanes"]')
        ?.click();
    });

    expect(
      view.host.querySelector('button[aria-label^="Hide "][aria-label$=" lanes"]'),
    ).not.toBeNull();
    expect(view.host.querySelectorAll("[data-automation-lane-label]")).toHaveLength(1);
    act(() => view.root.unmount());
  });

  it("renders an expanded envelope on a video track", () => {
    const video = element("video-clip", TRACK_A);
    video.tag = "video";
    video.automation = JSON.stringify({
      version: 1,
      lanes: [{ target: "volume", points: [{ t: 0, v: 1 }] }],
    });
    usePlayerStore.setState({ expandedLaneOwnerIds: new Set([video.id]) });
    const view = renderLanes({ elements: [video] });

    expect(
      view.host.querySelector('button[aria-label^="Hide "][aria-label$=" lanes"]'),
    ).not.toBeNull();
    expect(view.host.querySelectorAll("[data-automation-lane-label]")).toHaveLength(1);
    act(() => view.root.unmount());
  });

  it("toggles every clip owner on a shared audio row", () => {
    const automation = JSON.stringify({
      version: 1,
      lanes: [{ target: "volume", points: [{ t: 0, v: 1 }] }],
    });
    const first = { ...element("audio-1", TRACK_A), tag: "audio", automation };
    const second = { ...element("audio-2", TRACK_A), tag: "audio", automation };
    const view = renderLanes({ elements: [first, second] });

    act(() =>
      view.host
        .querySelector<HTMLButtonElement>('button[aria-label="Show Track 1 lanes"]')
        ?.click(),
    );

    expect(usePlayerStore.getState().expandedLaneOwnerIds).toEqual(new Set(["audio-1", "audio-2"]));
    act(() => view.root.unmount());
  });
});

describe("TimelineLanes selection", () => {
  it("keeps a selected clip selected when it is clicked again", () => {
    const selected = element("clip-a", TRACK_A);
    const view = renderLanes({
      elements: [selected],
      selectedElementIds: new Set([selected.id]),
    });

    act(() => view.host.querySelector<HTMLButtonElement>('[data-el-id="clip-a"]')?.click());

    expect(view.setSelectedElementId).toHaveBeenCalledWith(selected.id);
    expect(view.onSelectElement).toHaveBeenCalledWith(selected);
    act(() => view.root.unmount());
  });
});

describe("TimelineLanes clip thumbnails", () => {
  it("keeps thumbnail content inside a selected clip", () => {
    const selected = element("clip-a", TRACK_A);
    const view = renderLanes({
      elements: [selected],
      selectedElementIds: new Set([selected.id]),
      renderClipContent: () => <div className="absolute inset-0 bg-neutral-900" data-thumbnail />,
    });

    const clip = view.host.querySelector('[data-el-id="clip-a"]');
    expect(clip?.classList.contains("is-selected")).toBe(true);
    expect(clip?.querySelector("[data-thumbnail]")).not.toBeNull();
    act(() => view.root.unmount());
  });

  it("asks for the same frames at rest, hovered and selected", () => {
    const rich: unknown[] = [];
    const renderClipContent = vi.fn(
      (_el: TimelineElement, _style: unknown, context: { rich: boolean }) => {
        rich.push(context.rich);
        return null;
      },
    );
    const elements = [element("clip-a", TRACK_A)];
    const view = renderLanes({ elements, renderClipContent });
    view.rerender({ elements, renderClipContent, hoveredClip: "clip-a" });
    view.rerender({ elements, renderClipContent, selectedElementIds: new Set(["clip-a"]) });
    expect(new Set(rich)).toEqual(new Set([false]));
    act(() => view.root.unmount());
  });
});
