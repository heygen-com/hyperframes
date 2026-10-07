import { useState, useSyncExternalStore } from "react";

/** How long the timeline must go without a zoom step to count as at rest. */
export const TIMELINE_REST_MS = 150;

let moving = false;
let restTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

/** A zoom step: work that only matters at rest (redraws, decodes) waits for the zoom to end. */
export function markTimelineMotion(): void {
  if (!moving) {
    moving = true;
    emit();
  }
  if (restTimer) clearTimeout(restTimer);
  restTimer = setTimeout(() => {
    restTimer = null;
    moving = false;
    emit();
  }, TIMELINE_REST_MS);
}

export function isTimelineMoving(): boolean {
  return moving;
}

export function subscribeTimelineMotion(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `value` at rest; while the timeline moves, the value it had when it last rested. */
export function useValueAtRest<T>(value: T): T {
  // Re-renders only when a zoom starts and when it rests.
  const moving = useSyncExternalStore(subscribeTimelineMotion, isTimelineMoving, () => false);
  const [held, setHeld] = useState(value);
  if (!moving && !Object.is(held, value)) setHeld(value);
  return moving ? held : value;
}
