/**
 * Keyboard surface for the active automation selection: Escape clears,
 * Delete/Backspace empties the range (anchors pinned, envelope outside
 * untouched). Sibling of useKeyframeKeyboard and copies its contract:
 * capture phase so playback shortcuts cannot swallow keys we act on, inert
 * while any text input has focus, and a key is only consumed when it does
 * something.
 */
import { useEffect } from "react";
import { usePlayerStore, type TimelineElement } from "../player/store/playerStore";
import { laneFor, withLane } from "../player/components/automationLaneGeometry";
import { replaceRange } from "../player/components/automationLaneSelection";
import { resolveAutomationRange, type HfAutomation } from "@hyperframes/core/audio-automation";
import type { AutomationSelection } from "../player/store/automationSelectionSlice";
import type { UseAutomationLanesResult } from "../player/components/useAutomationLanes";

function isTextInput(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el instanceof HTMLElement && el.isContentEditable;
}

/**
 * The write that empties the active selection, or null when there is nothing
 * to do: the clip is gone, its lane is read-only, the target no longer
 * resolves to a range, or the lane already has no points in it. Split out of
 * the keydown handler so each stays under the complexity a single branch of
 * keyboard dispatch should carry.
 */
function resolveDeleteWrite(
  state: { elements: TimelineElement[]; selectedElementId: string | null },
  lanes: UseAutomationLanesResult,
  sel: AutomationSelection,
): { onCommit(next: HfAutomation): void; next: HfAutomation } | null {
  const element = state.elements.find((el) => (el.key ?? el.id) === sel.elementKey);
  if (!element) return null;
  const binding = lanes.bind(element, sel.elementKey === state.selectedElementId);
  if (binding.readOnly) return null;
  const lane = laneFor(binding.automation, sel.target);
  const range = resolveAutomationRange(sel.target, binding.chain ?? undefined);
  if (!range || lane.points.length === 0) return null;
  const points = replaceRange({ lane, range, t0: sel.t0, t1: sel.t1, inner: [] });
  return {
    onCommit: binding.onCommit,
    next: withLane(binding.automation, { target: sel.target, points }),
  };
}

export function useAutomationSelectionKeyboard({
  lanes,
}: {
  lanes: UseAutomationLanesResult;
}): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (isTextInput(document.activeElement)) return;
      const state = usePlayerStore.getState();
      const sel = state.automationSelection;
      if (!sel) return;

      if (e.key === "Escape") {
        state.clearAutomationSelection();
        return;
      }
      const isDeleteKey = e.key === "Delete" || e.key === "Backspace";
      if (!isDeleteKey || e.metaKey || e.ctrlKey) return;

      const write = resolveDeleteWrite(state, lanes, sel);
      if (!write) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      write.onCommit(write.next);
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [lanes]);
}
