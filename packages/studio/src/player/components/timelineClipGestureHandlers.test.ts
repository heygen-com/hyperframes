// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { PointerEvent as ReactPointerEvent } from "react";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { createClipGestureHandlers, type ClipGestureDeps } from "./timelineClipGestureHandlers";
import { MAX_HAND_EDIT_CLIPS } from "./timelineEditing";

afterEach(() => usePlayerStore.getState().reset());

const clips: TimelineElement[] = Array.from({ length: 6 }, (_, i) => ({
  id: `clip-${i}`,
  domId: `clip-${i}`,
  tag: "div",
  start: i,
  duration: 1,
  track: i,
}));
const capabilities = { canMove: true, canTrimStart: true, canTrimEnd: true, readOnly: false };

function grabFirstClip(count: number, gesture: "move" | "resize", locked: number[] = []) {
  const store = usePlayerStore.getState();
  store.setElements(
    clips.map((clip, i) => (locked.includes(i) ? { ...clip, timelineLocked: true } : clip)),
  );
  store.setSelectedElementIds(new Set(clips.slice(0, count).map((c) => c.id)));
  const setDraggedClip = vi.fn();
  const setResizingClip = vi.fn();
  const blockedClipRef = { current: null as { intent: string } | null };
  const deps = {
    pps: 100,
    onMoveElement: vi.fn(),
    onResizeElement: vi.fn(),
    blockedClipRef,
    suppressClickRef: { current: false },
    scrollRef: { current: null },
    setShowPopover: vi.fn(),
    setRangeSelection: vi.fn(),
    setResizingClip,
    setDraggedClip,
    setSelectedElementId: vi.fn(),
  } as unknown as ClipGestureDeps;
  const handlers = createClipGestureHandlers(clips[0], clips[0].id, clips[0], capabilities, deps);
  const event = {
    button: 0,
    clientX: 50,
    clientY: 5,
    pointerId: 1,
    stopPropagation: vi.fn(),
    currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 100 }) },
  } as unknown as ReactPointerEvent;
  if (gesture === "move") handlers.onPointerDown(event);
  else handlers.onResizeStart("end", event);
  return { setDraggedClip, setResizingClip, blockedClipRef };
}

describe("hand-editing a multi-selection", () => {
  it("moves up to the limit by hand", () => {
    const { setDraggedClip, blockedClipRef } = grabFirstClip(MAX_HAND_EDIT_CLIPS, "move");
    expect(setDraggedClip).toHaveBeenCalledOnce();
    expect(blockedClipRef.current).toBeNull();
  });

  it("refuses to start a drag above the limit and asks for the toast", () => {
    const { setDraggedClip, blockedClipRef } = grabFirstClip(MAX_HAND_EDIT_CLIPS + 1, "move");
    expect(setDraggedClip).not.toHaveBeenCalled();
    expect(blockedClipRef.current?.intent).toBe("edit-many");
  });

  it("resizes up to the limit by hand", () => {
    const { setResizingClip, blockedClipRef } = grabFirstClip(MAX_HAND_EDIT_CLIPS, "resize");
    expect(setResizingClip).toHaveBeenCalledOnce();
    expect(blockedClipRef.current).toBeNull();
  });

  it("refuses to start a resize above the limit and asks for the toast", () => {
    const { setResizingClip, blockedClipRef } = grabFirstClip(MAX_HAND_EDIT_CLIPS + 1, "resize");
    expect(setResizingClip).not.toHaveBeenCalled();
    expect(blockedClipRef.current?.intent).toBe("edit-many");
  });

  it("counts the clips a move would change: locked ones in the selection stay put", () => {
    const allowed = grabFirstClip(MAX_HAND_EDIT_CLIPS + 2, "move", [3, 4]);
    expect(allowed.setDraggedClip).toHaveBeenCalledOnce();
    const refused = grabFirstClip(MAX_HAND_EDIT_CLIPS + 2, "move", [4]);
    expect(refused.setDraggedClip).not.toHaveBeenCalled();
  });

  it("counts the clips a trim would change: a locked member leaves a trim of the grabbed clip alone", () => {
    const allowed = grabFirstClip(MAX_HAND_EDIT_CLIPS + 1, "resize", [3]);
    expect(allowed.setResizingClip).toHaveBeenCalledOnce();
    expect(allowed.blockedClipRef.current).toBeNull();
  });
});
