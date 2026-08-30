/**
 * `studio_look`: the one call that orients an agent.
 *
 * Deliberately fat. Every field here is one the agent would otherwise have to
 * spend a round trip discovering.
 *
 * The building is a pure function over a snapshot so it can be tested with
 * values. Gathering the snapshot is the React layer's job.
 */

import type { DomEditSelection } from "../../components/editor/domEditingTypes";
import type { TimelineElement } from "../../player/store/timelineElement";
import { mintElementHandle, patchTargetAddress, timelineElementAddress } from "../handles";
import { toolOk, type ToolResult } from "../toolResult";

export interface StudioLookSnapshot {
  projectId: string | null;
  compositionPath: string | null;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  elements: readonly TimelineElement[];
  selection: DomEditSelection | null;
  /** Live animations for the current selection arrive outside DomEditSelection. */
  selectionAnimationCount: number;
  /**
   * The undo stack as Studio's shell actually exposes it.
   *
   * This is a weaker signal than a revision counter, and deliberately not
   * dressed up as one: the depth lives in component-local state and is not
   * reachable here without plumbing it through the shell context. What an agent
   * CAN do is checkpoint `undoLabel` before a batch and notice it change to
   * something it did not do, which means a human pressed undo and its earlier
   * edits are gone.
   */
  history: {
    canUndo: boolean;
    canRedo: boolean;
    undoLabel: string | null;
    redoLabel: string | null;
  };
}

interface LookElement {
  /** Pass back to any tool that takes a handle. Null means unaddressable. */
  handle: string | null;
  label: string | null;
  tag: string;
  kind: string | null;
  start: number;
  duration: number;
  track: number;
  zIndex: number | null;
}

interface LookSelection {
  handle: string | null;
  label: string;
  tagName: string;
  sourceFile: string;
  box: { x: number; y: number; width: number; height: number };
  text: string | null;
  /** What this element will and will not accept, straight from Studio. */
  can: {
    editStyles: boolean;
    move: boolean;
    resize: boolean;
    editText: boolean;
    reasonIfDisabled: string | null;
  };
  animationCount: number;
}

/**
 * Session-scoped response shape. There is intentionally no schema version:
 * WebMCP consumers discover the current tool and schema when they connect
 * rather than pinning a cached REST response contract.
 */
export interface StudioLook {
  projectId: string | null;
  compositionPath: string | null;
  playhead: number;
  duration: number;
  isPlaying: boolean;
  history: StudioLookSnapshot["history"];
  selection: LookSelection | null;
  elementCount: number;
  elements: LookElement[];
}

export interface StudioLookInput {
  /** Case-insensitive substring match against label, tag, and handle. */
  filter?: string;
  /** Cap the returned list. The full count is always reported separately. */
  limit?: number;
}

const DEFAULT_LIMIT = 200;
const MAX_FILTER_LENGTH = 128;

function describeElement(element: TimelineElement): LookElement {
  return {
    handle: mintElementHandle(timelineElementAddress(element)),
    label: element.label ?? null,
    tag: element.tag,
    kind: element.kind ?? null,
    start: element.start,
    duration: element.duration,
    track: element.track,
    zIndex: element.zIndex ?? null,
  };
}

function describeSelection(selection: DomEditSelection, animationCount: number): LookSelection {
  const { capabilities } = selection;
  return {
    handle: mintElementHandle(patchTargetAddress(selection)),
    label: selection.label,
    tagName: selection.tagName,
    sourceFile: selection.sourceFile,
    box: selection.boundingBox,
    text: selection.textContent,
    can: {
      editStyles: capabilities.canEditStyles,
      move: capabilities.canMove || capabilities.canApplyManualOffset,
      resize: capabilities.canResize || capabilities.canApplyManualSize,
      editText: selection.textFields.length > 0,
      reasonIfDisabled: capabilities.reasonIfDisabled ?? null,
    },
    animationCount,
  };
}

function matchesFilter(element: LookElement, needle: string): boolean {
  return (
    (element.label?.toLowerCase().includes(needle) ?? false) ||
    element.tag.toLowerCase().includes(needle) ||
    (element.handle?.toLowerCase().includes(needle) ?? false)
  );
}

export function buildStudioLook(
  snapshot: StudioLookSnapshot,
  input: StudioLookInput = {},
): ToolResult<StudioLook> {
  const described = snapshot.elements.map(describeElement);
  const needle = input.filter?.slice(0, MAX_FILTER_LENGTH).trim().toLowerCase();
  const matched = needle
    ? described.filter((element) => matchesFilter(element, needle))
    : described;

  // Clamp rather than reject: a bad limit should not cost the agent a round trip
  // when the answer it wants is right here.
  const requested =
    Number.isInteger(input.limit) && input.limit! > 0 ? input.limit! : DEFAULT_LIMIT;
  const limit = Math.min(requested, DEFAULT_LIMIT);

  return toolOk<StudioLook>({
    projectId: snapshot.projectId,
    compositionPath: snapshot.compositionPath,
    playhead: snapshot.currentTime,
    duration: snapshot.duration,
    isPlaying: snapshot.isPlaying,
    history: snapshot.history,
    selection: snapshot.selection
      ? describeSelection(snapshot.selection, snapshot.selectionAnimationCount)
      : null,
    // The count is of everything that MATCHED, so a truncated list is visible
    // as a truncated list rather than reading as "that is all there is".
    elementCount: matched.length,
    elements: matched.slice(0, limit),
  });
}

export const STUDIO_LOOK_INPUT_SCHEMA = {
  type: "object",
  properties: {
    filter: {
      type: "string",
      maxLength: MAX_FILTER_LENGTH,
      description: "Case-insensitive substring matched against element label, tag, and handle.",
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: DEFAULT_LIMIT,
      description: `Cap the returned elements (default and max ${DEFAULT_LIMIT}). elementCount always reports the full match count.`,
    },
  },
  additionalProperties: false,
} as const;

export const STUDIO_LOOK_DESCRIPTION = [
  "Read HyperFrames Studio's live state in one call: the open project and composition,",
  "the playhead and duration, what the human currently has selected (including what that",
  "element will and will not accept), and the timeline's elements with a handle for each.",
  "Pass a handle back to any tool that edits an element.",
  "Returns an object with `ok: true`, or `ok: false` with `kind`, `reason` and often a `hint`.",
  "`history.undoLabel` is worth checkpointing before a batch: if it later names something",
  "you did not do, a human pressed undo and your earlier edits are gone.",
].join(" ");
