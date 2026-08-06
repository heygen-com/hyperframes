import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * Which single track the timeline is scoped to, if any.
 *
 * A range selection is made on the ruler and so spans every track by
 * construction. This is the other axis: one lane, so an edit request can mean
 * "these elements, on this track" and, more usefully, "add a new one here".
 *
 * It is a module-scoped store rather than a context because its two readers
 * live in different subtrees. The track header sits inside the canvas, and the
 * popover that turns a selection into a request is the canvas's sibling, so
 * there is no component that wraps both without reaching Timeline.tsx, which is
 * at the studio line cap.
 */

let selectedLane: number | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function read(): number | null {
  return selectedLane;
}

/** Scope the timeline to one display lane, or to nothing. */
export function selectTimelineTrack(lane: number | null): void {
  if (selectedLane === lane) return;
  selectedLane = lane;
  emit();
}

/** Clicking the selected track again is how it is let go of. */
export function toggleTimelineTrack(lane: number): void {
  selectTimelineTrack(selectedLane === lane ? null : lane);
}

export function useSelectedTimelineTrack(): number | null {
  return useSyncExternalStore(subscribe, read, read);
}

/** Read the selection without subscribing, for one-shot handlers. */
export function getSelectedTimelineTrack(): number | null {
  return selectedLane;
}

/** Test seam: no test should inherit another's selection. */
export function resetTimelineTrackSelection(): void {
  selectedLane = null;
  listeners.clear();
}

/** The selection and the two ways to change it, for a row header. */
export function useTimelineTrackSelection(): {
  selectedLane: number | null;
  toggle: (lane: number) => void;
  clear: () => void;
} {
  const lane = useSelectedTimelineTrack();
  return {
    selectedLane: lane,
    toggle: useCallback((next: number) => toggleTimelineTrack(next), []),
    clear: useCallback(() => selectTimelineTrack(null), []),
  };
}

/**
 * Escape lets a track go, the same key that dismisses every other transient
 * selection in the editor. Mounted once, by the canvas.
 */
export function useClearTrackSelectionOnEscape(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && selectedLane !== null) selectTimelineTrack(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
