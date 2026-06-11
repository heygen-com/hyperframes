/**
 * Optional history module (F5 layering).
 *
 * Wires onto a Composition session via on('patch') and implements undo/redo.
 * Coalesces same-op+same-targets bursts within coalesceMs into one undo entry.
 *
 * Usage (standalone / T1):
 *   const comp = await openComposition(html, { persist });
 *   // openComposition attaches this automatically in non-embedded mode.
 *
 * Usage (manual / custom undo timeline):
 *   const history = createHistory(comp, { coalesceMs: 500, trackedOrigins: ['local'] });
 *   // host calls history.undo() / history.redo() instead of comp.undo() / comp.redo()
 */

import type { Composition, JsonPatchOp, PatchEvent } from "./types.js";
import { ORIGIN_APPLY_PATCHES } from "./types.js";

export interface HistoryEntry {
  readonly patches: readonly JsonPatchOp[];
  readonly inversePatches: readonly JsonPatchOp[];
  readonly opTypes: readonly string[];
  readonly origin: unknown;
  readonly timestamp: number;
}

export interface HistoryModule {
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  dispose(): void;
}

export interface HistoryOptions {
  /** Only ops with these origins enter the undo stack. Default: all non-ORIGIN_APPLY_PATCHES. */
  trackedOrigins?: unknown[];
  /** Coalesce window in ms. Same opTypes + same origin within window → one entry. Default: 300. */
  coalesceMs?: number;
  /** Max undo stack depth. Default: 100. */
  maxEntries?: number;
}

export function createHistory(session: Composition, opts: HistoryOptions = {}): HistoryModule {
  const coalesceMs = opts.coalesceMs ?? 300;
  const maxEntries = opts.maxEntries ?? 100;
  const { trackedOrigins } = opts;

  const undoStack: HistoryEntry[] = [];
  let redoStack: HistoryEntry[] = [];

  function isTracked(origin: unknown): boolean {
    if (origin === ORIGIN_APPLY_PATCHES) return false;
    if (!trackedOrigins) return true;
    return trackedOrigins.includes(origin);
  }

  function pathsKey(patches: readonly JsonPatchOp[]): string {
    return patches
      .map((p) => p.path)
      .sort()
      .join("\n");
  }

  function opTypesKey(opTypes: readonly string[]): string {
    // Sorted: the same op-type SET coalesces regardless of dispatch order.
    return [...opTypes].sort().join(",");
  }

  function shouldCoalesce(entry: HistoryEntry, incoming: PatchEvent): boolean {
    if (coalesceMs <= 0) return false;
    if (opTypesKey(entry.opTypes) !== opTypesKey(incoming.opTypes)) return false;
    if (entry.origin !== incoming.origin) return false;
    // Coalesce only when the SAME paths are touched (e.g. slider drag on one
    // property). Without this, rapid edits to different elements would merge
    // into one entry holding the second forward + first inverse — undo would
    // then revert the wrong element.
    if (pathsKey(entry.patches) !== pathsKey(incoming.patches)) return false;
    const now = Date.now();
    return now - entry.timestamp <= coalesceMs;
  }

  // fallow-ignore-next-line complexity
  const unsubscribe = session.on("patch", (event: PatchEvent) => {
    if (!isTracked(event.origin)) return;

    const last = undoStack[undoStack.length - 1];
    if (last && shouldCoalesce(last, event)) {
      // Coalesce: keep first inverse (original prev), replace forward with latest value.
      // Slide timestamp forward so rapid-fire edits keep coalescing.
      const coalesced: HistoryEntry = {
        patches: event.patches,
        inversePatches: last.inversePatches,
        opTypes: last.opTypes,
        origin: last.origin,
        timestamp: Date.now(),
      };
      undoStack[undoStack.length - 1] = coalesced;
    } else {
      undoStack.push({
        patches: event.patches,
        inversePatches: event.inversePatches,
        opTypes: event.opTypes,
        origin: event.origin,
        timestamp: Date.now(),
      });
      if (undoStack.length > maxEntries) undoStack.shift();
    }

    // Any new op clears the redo stack.
    redoStack = [];
  });

  return {
    undo(): boolean {
      const entry = undoStack.pop();
      if (!entry) return false;
      session.applyPatches(entry.inversePatches, { origin: ORIGIN_APPLY_PATCHES });
      redoStack.push(entry);
      return true;
    },

    redo(): boolean {
      const entry = redoStack.pop();
      if (!entry) return false;
      session.applyPatches(entry.patches, { origin: ORIGIN_APPLY_PATCHES });
      undoStack.push(entry);
      return true;
    },

    canUndo(): boolean {
      return undoStack.length > 0;
    },

    canRedo(): boolean {
      return redoStack.length > 0;
    },

    dispose(): void {
      unsubscribe();
      undoStack.length = 0;
      redoStack.length = 0;
    },
  };
}
