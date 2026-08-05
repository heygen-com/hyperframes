/**
 * Keyboard surface for the active automation selection: Escape clears,
 * Delete/Backspace empties the range (anchors pinned, envelope outside
 * untouched), Cmd/Ctrl+C copies it, Cmd/Ctrl+V pastes at the selection's
 * start (or the playhead) onto the selected clip's lane. Sibling of
 * useKeyframeKeyboard and copies its contract: capture phase so playback
 * shortcuts cannot swallow keys we act on, inert while any text input has
 * focus, and a key is only consumed when it does something — paste in
 * particular must fall through untouched when no lane can take it, so
 * clip-level paste keeps working.
 */
import { useEffect } from "react";
import { usePlayerStore, type TimelineElement } from "../player/store/playerStore";
import { laneFor, withLane } from "../player/components/automationLaneGeometry";
import { replaceRange } from "../player/components/automationLaneSelection";
import { copyRange, pastePoints, readClipboard } from "../player/components/automationClipboard";
import {
  resolveAutomationRange,
  type AutomationRange,
  type HfAutomation,
  type HfAutomationLane,
} from "@hyperframes/core/audio-automation";
import type { AutomationSelection } from "../player/store/automationSelectionSlice";
import type {
  AutomationLaneBinding,
  UseAutomationLanesResult,
} from "../player/components/useAutomationLanes";

type PlayerState = ReturnType<typeof usePlayerStore.getState>;

function isTextInput(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el instanceof HTMLElement && el.isContentEditable;
}

/** Clamp `v` to `[min, max]`, tolerating an inverted range (max < min). */
function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), Math.max(min, max));
}

/** A `TimelineElement`'s identity as the selection and lane bindings key by. */
function elementKeyOf(element: TimelineElement): string {
  return element.key ?? element.id;
}

function findElement(elements: TimelineElement[], key: string | null): TimelineElement | null {
  if (!key) return null;
  return elements.find((el) => elementKeyOf(el) === key) ?? null;
}

/**
 * A selection's element, binding, lane and range — the resolution Delete and
 * copy both need. Null when the clip is gone, its lane is read-only, or the
 * target no longer resolves to a range.
 */
function resolveSelectionContext(
  state: PlayerState,
  lanes: UseAutomationLanesResult,
  sel: AutomationSelection,
): { binding: AutomationLaneBinding; lane: HfAutomationLane; range: AutomationRange } | null {
  const element = findElement(state.elements, sel.elementKey);
  if (!element) return null;
  const binding = lanes.bind(element, sel.elementKey === state.selectedElementId);
  if (binding.readOnly) return null;
  const range = resolveAutomationRange(sel.target, binding.chain ?? undefined);
  if (!range) return null;
  return { binding, lane: laneFor(binding.automation, sel.target), range };
}

/**
 * The write that empties the active selection, or null when there is nothing
 * to do: the clip is gone, its lane is read-only, the target no longer
 * resolves to a range, or the lane already has no points in it. Split out of
 * the keydown handler so each stays under the complexity a single branch of
 * keyboard dispatch should carry.
 */
function resolveDeleteWrite(
  state: PlayerState,
  lanes: UseAutomationLanesResult,
  sel: AutomationSelection,
): { onCommit(next: HfAutomation): void; next: HfAutomation } | null {
  const ctx = resolveSelectionContext(state, lanes, sel);
  if (!ctx || ctx.lane.points.length === 0) return null;
  const points = replaceRange({
    lane: ctx.lane,
    range: ctx.range,
    t0: sel.t0,
    t1: sel.t1,
    inner: [],
  });
  return {
    onCommit: ctx.binding.onCommit,
    next: withLane(ctx.binding.automation, { target: sel.target, points }),
  };
}

/**
 * The lane target Cmd+V writes to: the active selection's, when the
 * selection belongs to the same clip the paste is landing on, else the
 * clip's first automation lane. A selection left over on a different clip
 * does not redirect the paste.
 */
function pasteTargetName(
  binding: AutomationLaneBinding,
  elementKey: string,
  sel: AutomationSelection | null,
): string | undefined {
  if (sel && sel.elementKey === elementKey) return sel.target;
  return binding.lanes[0]?.target;
}

/**
 * Where Cmd+V lands, or null when nothing is selected, the clip's lanes are
 * read-only, or it has no automation lane to fall back to.
 */
function resolvePasteTarget(
  state: PlayerState,
  lanes: UseAutomationLanesResult,
  sel: AutomationSelection | null,
): {
  elementKey: string;
  element: TimelineElement;
  target: string;
  binding: AutomationLaneBinding;
  lane: HfAutomationLane;
  range: AutomationRange;
} | null {
  const element = findElement(state.elements, state.selectedElementId);
  if (!element) return null;
  const elementKey = elementKeyOf(element);
  const binding = lanes.bind(element, true);
  if (binding.readOnly) return null;
  const target = pasteTargetName(binding, elementKey, sel);
  if (!target) return null;
  const range = resolveAutomationRange(target, binding.chain ?? undefined);
  if (!range) return null;
  return { elementKey, element, target, binding, lane: laneFor(binding.automation, target), range };
}

/**
 * Cmd/Ctrl+V: paste the clipboard onto the selected clip's lane, at the
 * active selection's start or the playhead. Returns false (untouched event)
 * when the combo doesn't match, there is nothing to paste, or no lane can
 * take it — clip-level paste needs the fall-through in that last case.
 * Checked ahead of the "no selection" guard in the handler below: paste must
 * work from the playhead with no active selection at all.
 */
function handlePaste(
  e: KeyboardEvent,
  state: PlayerState,
  lanes: UseAutomationLanesResult,
): boolean {
  if (!((e.metaKey || e.ctrlKey) && e.key === "v")) return false;
  const clip = readClipboard();
  if (!clip) return false;
  const sel = state.automationSelection;
  const paste = resolvePasteTarget(state, lanes, sel);
  if (!paste) return false;

  const atT =
    sel && sel.elementKey === paste.elementKey
      ? sel.t0
      : clamp(state.currentTime - paste.element.start, 0, paste.element.duration - clip.span);
  const t1 = atT + clip.span;
  const inner = pastePoints(clip, paste.range, atT);
  const points = replaceRange({ lane: paste.lane, range: paste.range, t0: atT, t1, inner });

  e.preventDefault();
  e.stopImmediatePropagation();
  paste.binding.onCommit(withLane(paste.binding.automation, { target: paste.target, points }));
  // Covers the pasted span so an immediate second Cmd+V chains right after
  // this one instead of overwriting it.
  state.setAutomationSelection({ elementKey: paste.elementKey, target: paste.target, t0: atT, t1 });
  return true;
}

/** Cmd/Ctrl+C on the active selection. Returns false when the combo doesn't
 *  match or the selection no longer resolves to a copyable lane. */
function handleCopy(
  e: KeyboardEvent,
  state: PlayerState,
  lanes: UseAutomationLanesResult,
  sel: AutomationSelection,
): boolean {
  if (!((e.metaKey || e.ctrlKey) && e.key === "c")) return false;
  const ctx = resolveSelectionContext(state, lanes, sel);
  if (!ctx) return false;
  copyRange(ctx.lane, ctx.range, sel.t0, sel.t1);
  e.preventDefault();
  e.stopImmediatePropagation();
  return true;
}

/** Delete/Backspace on the active selection. Returns false when the key
 *  doesn't match or there is nothing to empty. */
function handleDelete(
  e: KeyboardEvent,
  state: PlayerState,
  lanes: UseAutomationLanesResult,
  sel: AutomationSelection,
): boolean {
  const isDeleteKey = e.key === "Delete" || e.key === "Backspace";
  if (!isDeleteKey || e.metaKey || e.ctrlKey) return false;
  const write = resolveDeleteWrite(state, lanes, sel);
  if (!write) return false;
  e.preventDefault();
  e.stopImmediatePropagation();
  write.onCommit(write.next);
  return true;
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
      if (handlePaste(e, state, lanes)) return;

      const sel = state.automationSelection;
      if (!sel) return;

      if (e.key === "Escape") {
        state.clearAutomationSelection();
        return;
      }
      if (handleCopy(e, state, lanes, sel)) return;
      handleDelete(e, state, lanes, sel);
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [lanes]);
}
