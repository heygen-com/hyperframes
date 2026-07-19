// @vitest-environment happy-dom

import React, { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../store/playerStore";
import { createTimelineRowGeometry } from "./timelineLayout";
import type { TimelineLogicalRow } from "./timelineKeyboardNavigation";
import { useTimelineKeyboardActor } from "./useTimelineKeyboardActor";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

const rows: readonly TimelineLogicalRow[] = [
  {
    id: "track-1",
    kind: "row",
    physicalTrackKey: 1,
    logicalIndex: 0,
    level: 1,
    parentId: null,
    elementId: "clip-1",
    expandable: true,
    expanded: false,
    items: [{ id: "clip-1", kind: "clip", rowId: "track-1", elementId: "clip-1", time: 1 }],
  },
  {
    id: "track-2",
    kind: "row",
    physicalTrackKey: 2,
    logicalIndex: 1,
    level: 1,
    parentId: null,
    elementId: "clip-2",
    expandable: false,
    expanded: false,
    items: [{ id: "clip-2", kind: "clip", rowId: "track-2", elementId: "clip-2", time: 2 }],
  },
  {
    id: "track-3",
    kind: "row",
    physicalTrackKey: 3,
    logicalIndex: 2,
    level: 1,
    parentId: null,
    elementId: null,
    expandable: false,
    expanded: false,
    items: [],
  },
];

interface HarnessProps {
  focusedTargetId?: string | null;
  onToggleRow?: (target: TimelineLogicalRow) => void;
}

function Harness({ focusedTargetId = null, onToggleRow = vi.fn() }: HarnessProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const keyboard = useTimelineKeyboardActor({
    logicalRows: rows,
    focusedTargetId,
    rowGeometry: createTimelineRowGeometry([1, 2, 3], [48, 48, 48]),
    scrollRef,
    onToggleRow,
  });
  return (
    <div ref={scrollRef} onFocus={keyboard.onFocus} onKeyDown={keyboard.onKeyDown}>
      {rows
        .flatMap((row) => [row, ...row.items])
        .map((target) => (
          <button
            key={target.id}
            data-timeline-focus-id={target.id}
            tabIndex={target.id === keyboard.rovingTargetId ? 0 : -1}
          >
            {target.id}
          </button>
        ))}
    </div>
  );
}

function renderHarness(props: React.ComponentProps<typeof Harness> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<Harness {...props} />));
  return { host, root };
}

function key(target: Element, value: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: value,
    ...init,
  });
  act(() => target.dispatchEvent(event));
  return event;
}

afterEach(() => {
  document.body.innerHTML = "";
  usePlayerStore.setState({ timelineFocus: null, timelineFocusNonce: 0 });
});

describe("useTimelineKeyboardActor", () => {
  it("exposes exactly one roving target and persists focused logical identity", () => {
    const { host, root } = renderHarness({ focusedTargetId: "clip-2" });
    expect(host.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    const target = host.querySelector<HTMLElement>('[data-timeline-focus-id="track-3"]')!;
    act(() => target.focus());
    expect(usePlayerStore.getState().timelineFocus?.id).toBe("track-3");
    act(() => root.unmount());
  });

  it("requests navigation focus without clicking or seeking", () => {
    const { host, root } = renderHarness({ focusedTargetId: "clip-1" });
    const target = host.querySelector<HTMLElement>('[data-timeline-focus-id="clip-1"]')!;
    const click = vi.fn();
    target.addEventListener("click", click);
    const event = key(target, "ArrowDown");
    expect(event.defaultPrevented).toBe(true);
    expect(usePlayerStore.getState().timelineFocus?.id).toBe("clip-2");
    expect(usePlayerStore.getState().requestedSeekTime).toBeNull();
    expect(click).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("supports modified timeline boundaries and viewport-sized paging", () => {
    const { host, root } = renderHarness({ focusedTargetId: "clip-2" });
    const viewport = host.firstElementChild as HTMLDivElement;
    Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 48 });
    const target = host.querySelector<HTMLElement>('[data-timeline-focus-id="clip-2"]')!;
    key(target, "End", { metaKey: true });
    expect(usePlayerStore.getState().timelineFocus?.id).toBe("track-3");
    key(target, "PageUp");
    expect(usePlayerStore.getState().timelineFocus?.id).toBe("clip-1");
    act(() => root.unmount());
  });

  it("toggles expandable rows but leaves native control activation to the control", () => {
    const onToggleRow = vi.fn();
    const { host, root } = renderHarness({ focusedTargetId: "track-1", onToggleRow });
    const row = host.querySelector<HTMLElement>('[data-timeline-focus-id="track-1"]')!;
    const clip = host.querySelector<HTMLElement>('[data-timeline-focus-id="clip-1"]')!;
    expect(key(row, " ").defaultPrevented).toBe(true);
    expect(onToggleRow).toHaveBeenCalledWith(rows[0]);
    expect(key(clip, "Enter").defaultPrevented).toBe(false);
    expect(onToggleRow).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });

  it("dispatches the existing scoped context-menu callback", () => {
    const { host, root } = renderHarness({ focusedTargetId: "clip-1" });
    const target = host.querySelector<HTMLElement>('[data-timeline-focus-id="clip-1"]')!;
    const context = vi.fn((event: Event) => event.preventDefault());
    target.addEventListener("contextmenu", context);
    key(target, "F10", { shiftKey: true });
    expect(context).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });
});
