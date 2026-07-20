// @vitest-environment happy-dom

import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usePlayerStore } from "../store/playerStore";
import { createTimelineRowGeometry } from "./timelineLayout";
import type { TimelineLogicalRow } from "./timelineKeyboardNavigation";
import { timelineClipFocusId, timelineTrackRowId } from "./timelineNavigationIdentity";
import { useTimelineFocusCoordinator } from "./useTimelineFocusCoordinator";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const element = { id: "hero", tag: "div", start: 20, duration: 2, track: 1 };
const clipId = timelineClipFocusId("hero");
const rowId = timelineTrackRowId(1);
const geometry = createTimelineRowGeometry([1], [48]);
const rows: readonly TimelineLogicalRow[] = [
  {
    id: rowId,
    kind: "row",
    physicalTrackKey: 1,
    logicalIndex: 0,
    level: 1,
    parentId: null,
    elementId: null,
    expandable: false,
    expanded: false,
    items: [{ id: clipId, kind: "clip", rowId, elementId: "hero", time: 21 }],
  },
];

function Harness({
  mountedId,
  logicalRows = rows,
  projectId = "project-a",
}: {
  mountedId?: string;
  logicalRows?: readonly TimelineLogicalRow[];
  projectId?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const focus = useTimelineFocusCoordinator({
    scrollRef,
    logicalRows,
    elements: [element],
    rowGeometry: geometry,
    pixelsPerSecond: 100,
    contentOrigin: 32,
    allowHorizontal: true,
    viewportVersion: logicalRows,
    projectId,
    sessionEpoch: 1,
    syncScrollViewport: () => {},
  });
  return (
    <div
      ref={(node) => {
        scrollRef.current = node;
        if (node) {
          Object.defineProperty(node, "clientWidth", { configurable: true, value: 300 });
          Object.defineProperty(node, "clientHeight", { configurable: true, value: 100 });
        }
      }}
      data-focus={`${focus.focusedRowKey}:${focus.pinnedElementId}`}
    >
      {mountedId && <div data-timeline-focus-id={mountedId} tabIndex={-1} />}
    </div>
  );
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  usePlayerStore.setState({ timelineProjectId: "project-a", timelineSessionEpoch: 1 });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  usePlayerStore.getState().reset();
  document.body.replaceChildren();
});

describe("useTimelineFocusCoordinator", () => {
  it("pins and scrolls from model coordinates until mount, then permits repeat reveal", async () => {
    usePlayerStore.getState().requestTimelineFocus(clipId);
    await act(async () => root.render(<Harness />));
    const scroll = host.firstElementChild as HTMLDivElement;
    expect(scroll.scrollLeft).toBe(1_944);
    expect(scroll.dataset.focus).toBe("1:hero");
    expect(usePlayerStore.getState().timelineFocus?.id).toBe(clipId);

    await act(async () => root.render(<Harness mountedId={clipId} />));
    const firstNonce = usePlayerStore.getState().timelineFocus?.nonce;
    expect(usePlayerStore.getState().timelineFocus?.id).toBe(clipId);
    expect(document.activeElement?.getAttribute("data-timeline-focus-id")).toBe(clipId);

    scroll.scrollLeft = 0;
    await act(async () => usePlayerStore.getState().requestTimelineFocus(clipId));
    await act(async () => root.render(<Harness mountedId={clipId} />));
    expect(scroll.scrollLeft).toBe(1_944);
    expect(usePlayerStore.getState().timelineFocus?.nonce).toBe((firstNonce ?? 0) + 1);
  });

  it("focuses the latest request when it replaces an unmounted request", async () => {
    usePlayerStore.getState().requestTimelineFocus(rowId);
    usePlayerStore.getState().requestTimelineFocus(clipId);

    await act(async () => root.render(<Harness mountedId={clipId} />));
    expect(document.activeElement?.getAttribute("data-timeline-focus-id")).toBe(clipId);
  });

  it("ignores stale scope and never queries outside its own viewport", async () => {
    usePlayerStore.getState().requestTimelineFocus(clipId);
    await act(async () => root.render(<Harness mountedId={clipId} projectId="project-b" />));
    expect(document.activeElement).not.toBe(host.querySelector("[data-timeline-focus-id]"));
    expect(usePlayerStore.getState().timelineFocus?.id).toBe(clipId);

    const externalTarget = document.createElement("div");
    externalTarget.dataset.timelineFocusId = clipId;
    externalTarget.tabIndex = -1;
    document.body.append(externalTarget);
    await act(async () => root.render(<Harness />));
    expect(document.activeElement).not.toBe(externalTarget);
  });

  it("persists a deterministic parent-row fallback when a focused clip disappears", async () => {
    usePlayerStore.getState().requestTimelineFocus(clipId);
    await act(async () => root.render(<Harness />));

    const collapsedRows: readonly TimelineLogicalRow[] = [{ ...rows[0]!, items: [] }];
    await act(async () => root.render(<Harness logicalRows={collapsedRows} mountedId={rowId} />));
    expect(usePlayerStore.getState().timelineFocus?.id).toBe(rowId);
    expect(document.activeElement?.getAttribute("data-timeline-focus-id")).toBe(rowId);
  });
});
