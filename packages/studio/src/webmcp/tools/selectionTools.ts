/**
 * `studio_select` and `studio_seek`: pointing the human and the agent at the
 * same thing.
 *
 * Selection is shared state, not a per-call argument. That is deliberate and it
 * is also forced: most of Studio's edit handlers read the ambient React
 * selection, and `applyDomSelection` only schedules a state update, so
 * selecting and committing inside ONE call would write to whatever was selected
 * before. Two tool calls are separated by a render, so the contract is select
 * first, then act, which is also how a human works: click, then type.
 */

import type { DomEditSelection } from "../../components/editor/domEditingTypes";
import { mintElementHandle, patchTargetAddress, resolveElementHandle } from "../handles";
import { toolFailure, toolOk, type ToolResult } from "../toolResult";

export interface SelectionToolDeps {
  /** The preview iframe's document, or null before it mounts. */
  getPreviewDocument: () => Document | null;
  buildSelection: (element: HTMLElement) => Promise<DomEditSelection | null>;
  applySelection: (selection: DomEditSelection) => void;
  /** Out-of-loop seek. `requestSeek`, not `setCurrentTime`. */
  requestSeek: (time: number) => void;
  readPlayhead: () => { currentTime: number; duration: number; isPlaying: boolean };
}

export interface StudioSelectResult {
  handle: string | null;
  label: string;
  tagName: string;
  box: { x: number; y: number; width: number; height: number };
}

export async function studioSelect(
  deps: SelectionToolDeps,
  handle: string,
): Promise<ToolResult<StudioSelectResult>> {
  if (typeof handle !== "string" || !handle.trim()) {
    return toolFailure("invalid", "handle must be a non-empty string", "Call studio_look first.");
  }

  // Three distinct failures, deliberately not collapsed: "the preview is not up
  // yet" is a wait, "no such element" is a stale handle, and "could not build a
  // selection" is an element Studio cannot drive. The agent's next move differs
  // for each.
  const doc = deps.getPreviewDocument();
  if (!doc) {
    return toolFailure(
      "blocked",
      "the preview is not mounted yet",
      "Wait for the composition to load, then retry.",
    );
  }

  const element = resolveElementHandle(doc, handle);
  if (!element) {
    return toolFailure(
      "invalid",
      `no element matches handle ${handle}`,
      "The composition may have changed. Call studio_look for current handles.",
    );
  }

  const selection = await deps.buildSelection(element);
  if (!selection) {
    return toolFailure(
      "blocked",
      `${handle} resolved to an element Studio cannot select`,
      "Try a parent or child element from studio_look.",
    );
  }

  deps.applySelection(selection);
  return toolOk<StudioSelectResult>({
    handle: mintElementHandle(patchTargetAddress(selection)),
    label: selection.label,
    tagName: selection.tagName,
    box: selection.boundingBox,
  });
}

export interface StudioSeekResult {
  /** Where the playhead ACTUALLY landed, which may differ from the request. */
  playhead: number;
  duration: number;
  isPlaying: boolean;
  moved: boolean;
}

export function studioSeek(deps: SelectionToolDeps, time: number): ToolResult<StudioSeekResult> {
  if (typeof time !== "number" || !Number.isFinite(time)) {
    return toolFailure("invalid", "time must be a finite number of seconds");
  }

  const before = deps.readPlayhead();
  // Deliberately NOT clamped here. `seek()` already clamps against the
  // adapter's duration, which can differ from the store's, and a second clamp
  // would give that invariant two owners that can disagree. Report where it
  // landed instead.
  deps.requestSeek(time);
  const after = deps.readPlayhead();

  // `requestSeek` is fire-and-forget: it cannot report that no adapter was
  // mounted to receive it. Reading back is the only way to avoid claiming a
  // seek that never happened.
  const moved = after.currentTime !== before.currentTime;
  if (!moved && before.currentTime !== time) {
    return toolFailure(
      "blocked",
      `the playhead did not move; it is still at ${after.currentTime}`,
      "The preview may not be ready. Check studio_look, then retry.",
    );
  }

  return toolOk<StudioSeekResult>({
    playhead: after.currentTime,
    duration: after.duration,
    isPlaying: after.isPlaying,
    moved,
  });
}

export const STUDIO_SELECT_INPUT_SCHEMA = {
  type: "object",
  properties: {
    handle: { type: "string", description: "An element handle from studio_look." },
  },
  required: ["handle"],
  additionalProperties: false,
} as const;

export const STUDIO_SELECT_DESCRIPTION = [
  "Select an element in HyperFrames Studio, exactly as clicking it would:",
  "the human sees the same selection box and inspector.",
  "Takes a handle from studio_look. Most editing tools act on the CURRENT selection,",
  "so call this first, then the edit.",
  "Returns `ok: true` with the resulting selection, or `ok: false` with `kind`, `reason` and a `hint`.",
].join(" ");

export const STUDIO_SEEK_INPUT_SCHEMA = {
  type: "object",
  properties: {
    time: { type: "number", minimum: 0, description: "Playhead position in seconds." },
  },
  required: ["time"],
  additionalProperties: false,
} as const;

export const STUDIO_SEEK_DESCRIPTION = [
  "Move the playhead to a time in seconds. Pauses playback.",
  "Out-of-range times are clamped by the player, so check the returned `playhead`",
  "for where it actually landed rather than assuming it matched your request.",
  "Returns `ok: true`, or `ok: false` with `kind`, `reason` and a `hint`.",
].join(" ");
