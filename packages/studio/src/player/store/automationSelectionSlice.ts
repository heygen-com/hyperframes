/**
 * The active time selection on one automation lane.
 *
 * A store slice, not lane-local state, for the same reason keyframe selection
 * is one: Delete/copy/paste handlers and the shape menu live outside the lane
 * component and need to read it. Ephemeral by construction — nothing
 * serializes store state, and the selection must never survive into a render.
 */
import type { StoreApi } from "zustand";

export interface AutomationSelection {
  /** TimelineElement key (key ?? id) of the clip that owns the lane. */
  elementKey: string;
  /** Lane target: "volume" or "fx.<nodeId>.<param>". */
  target: string;
  /** Clip-local seconds; always t0 < t1 (ordered on write). */
  t0: number;
  t1: number;
}

export interface AutomationSelectionSlice {
  automationSelection: AutomationSelection | null;
  setAutomationSelection: (sel: AutomationSelection) => void;
  clearAutomationSelection: () => void;
}

export function createAutomationSelectionSlice(
  set: StoreApi<AutomationSelectionSlice>["setState"],
): AutomationSelectionSlice {
  return {
    automationSelection: null,
    setAutomationSelection: (sel) =>
      set({
        automationSelection: sel.t0 <= sel.t1 ? sel : { ...sel, t0: sel.t1, t1: sel.t0 },
      }),
    clearAutomationSelection: () => set({ automationSelection: null }),
  };
}
