/** A gap this much past a look's expected delay means the process was suspended, not that nothing landed. */
const SUSPEND_GAP_MS = 15_000;

export interface StallClock {
  /** Progress landed: the silence starts again. */
  reset(): void;
  /** Silent ms, not counting a suspended stretch; `expectedMs` is how long after the last look this one was due. */
  idle(expectedMs: number): number;
}

export function createStallClock(now: () => number = () => Date.now()): StallClock {
  let since = now();
  let seen = since;
  return {
    reset() {
      since = seen = now();
    },
    idle(expectedMs) {
      const at = now();
      const gap = at - seen;
      seen = at;
      if (gap > expectedMs + SUSPEND_GAP_MS) since += gap;
      return at - since;
    },
  };
}
