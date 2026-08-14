/**
 * Undo grouping for a lane gesture.
 *
 * Dragging a point persists on every move and once more on release. History
 * coalesces entries that share a key and land within 300ms of each other, and
 * these writes did neither: the moves and the release used different keys, and a
 * drag slower than the window split into several entries. Undo then took back
 * whatever fragment happened to be last, leaving the point near where the drag
 * had dropped it — which reads as undo not working at all.
 *
 * So a gesture mints one key and holds it: every move and the release that ends
 * it record under that key with no window to expire, and the next gesture gets a
 * fresh one so two drags never collapse into a single step.
 */

export interface CoalesceHint {
  key: string;
  /** No expiry: a gesture is one step however long the pointer is held. */
  ms: number;
}

export interface AutomationGestureKeys {
  /** A continuous write. Opens a gesture if one is not already open. */
  live(): CoalesceHint;
  /** The persisting write that ends a gesture — or a standalone edit. */
  commit(): CoalesceHint;
}

export function createAutomationGestureKeys(
  mint: () => string = () => `automation-gesture:${++counter}`,
): AutomationGestureKeys {
  let open: string | null = null;
  const hint = (key: string): CoalesceHint => ({ key, ms: Number.POSITIVE_INFINITY });
  return {
    live: () => {
      open ??= mint();
      return hint(open);
    },
    commit: () => {
      // A commit with no drag before it — a Delete, a paste, a typed value — is
      // its own step, so it mints rather than joining anything.
      const key = open ?? mint();
      open = null;
      return hint(key);
    },
  };
}

let counter = 0;
