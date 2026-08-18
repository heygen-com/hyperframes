/**
 * An animation-frame loop that parks when it has nothing to do.
 *
 * The canvas overlays each ran a `requestAnimationFrame` loop that rescheduled
 * itself unconditionally, so an idle Studio woke the page 240 times a second
 * for four bodies that all early-returned. Cheap is not free: the wake-up is
 * the cost. A loop built here schedules a frame only while `step` reports work
 * left, and is restarted by whatever signal creates the next piece of work.
 *
 * The hazard this shape introduces is a loop that parks and is never re-armed —
 * a stale overlay. Every caller must therefore have an explicit answer to "what
 * re-arms this", and a test for it.
 */
export interface OverlayFrameLoop {
  /**
   * Run `step` on the next frame. A no-op while a frame is already scheduled,
   * so a burst of signals in one frame costs one frame, and a no-op after
   * `stop`, so a late observer callback cannot resurrect an unmounted loop.
   */
  arm: () => void;
  /** Cancel any scheduled frame and refuse further arming. Terminal. */
  stop: () => void;
}

/** @param step Runs one frame; returns true while work remains. */
export function createOverlayFrameLoop(step: () => boolean): OverlayFrameLoop {
  let handle: number | null = null;
  let stopped = false;

  const arm = () => {
    if (stopped || handle !== null) return;
    handle = requestAnimationFrame(() => {
      handle = null;
      if (stopped) return;
      if (step()) arm();
    });
  };

  return {
    arm,
    stop: () => {
      stopped = true;
      if (handle !== null) cancelAnimationFrame(handle);
      handle = null;
    },
  };
}

/**
 * A boolean ref that tells listeners when it changes.
 *
 * Canvas gestures already announce themselves by writing a plain boolean ref —
 * true while a drag/resize/rotate runs, false once it ends. Two overlay loops
 * have work only across that edge (guides exist only during a gesture; the rect
 * tracker resumes only once one ends), and used to learn about it by reading
 * the ref every frame. Writers keep writing `.current` exactly as before; the
 * accessor turns the write into a notification.
 */
export interface GestureActiveRef {
  current: boolean;
  subscribe: (listener: () => void) => () => void;
}

export function createGestureActiveRef(): GestureActiveRef {
  let active = false;
  const listeners = new Set<() => void>();
  return {
    get current(): boolean {
      return active;
    },
    set current(next: boolean) {
      if (active === next) return;
      active = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
