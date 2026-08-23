// fallow-ignore-file code-duplication
// fallow-ignore-file dead-code
import type { TimelineElement } from "../store/playerStore";
import type { TimelineMoveOperation } from "../../hooks/timelineMoveAdapter";
import type { BlockedTimelineEditIntent } from "./timelineEditing";
import type { PropertyGroupName } from "@hyperframes/core/gsap-parser";
import type { TimelineKeyframeTarget } from "./timelineKeyframeIdentity";

export interface TimelinePropertyGroupKeyframeToggle {
  animationId: string;
  propertyGroup: PropertyGroupName;
  tweenPercentage: number;
  properties: Record<string, number | string>;
  remove: boolean;
}

/**
 * Shared callback signatures for timeline editing operations.
 * Used by NLELayout, Timeline, and any component that passes through
 * the standard set of timeline mutation handlers.
 */
export interface TimelineDropCallbacks {
  onFileDrop?: (
    files: File[],
    placement?: { start: number; track: number },
  ) => Promise<void> | void;
  onAssetDrop?: (
    assetPath: string,
    placement: { start: number; track: number },
  ) => Promise<void> | void;
  onBlockDrop?: (
    blockName: string,
    placement: { start: number; track: number },
  ) => Promise<void> | void;
  onCompositionDrop?: (
    sourcePath: string,
    placement: { start: number; track: number },
  ) => Promise<void> | void;
}

export interface TimelineEditCallbacks {
  onMoveElement?: (
    element: TimelineElement,
    updates: Pick<TimelineElement, "start" | "track">,
  ) => Promise<void> | void;
  /** Atomic multi-clip move (single undo) for main-track ripple + track-insert.
   *  `coalesceKey` (drag-commit gesture id) merges the move history entry with a
   *  lane change's follow-up z-reorder entry into one undo step; `coalesceMs`
   *  widens that entry's fold window when a server round-trip separates the
   *  gesture's records (per-gesture-unique keys keep the fold gesture-scoped). */
  onMoveElements?: (
    edits: Array<{ element: TimelineElement; updates: Pick<TimelineElement, "start" | "track"> }>,
    coalesceKey?: string,
    operation?: TimelineMoveOperation,
    coalesceMs?: number,
  ) => Promise<void> | void;
  onResizeElement?: (
    element: TimelineElement,
    updates: Pick<TimelineElement, "start" | "duration" | "playbackStart">,
  ) => Promise<void> | void;
  onResizeElements?: (
    changes: Array<{
      element: TimelineElement;
      start: number;
      duration: number;
      playbackStart?: number;
    }>,
    options?: { coalesceKey?: string },
  ) => Promise<void> | void;
  /**
   * `displayNumber` is the row the CLICKED control announced. It travels with
   * the click because the header and the undo-history label derive the row from
   * two different orderings: the header's comes from the group-aware row list
   * (synthetic anchor rows, members pulled contiguous), the history's from a
   * plain ascending sort of element-bearing keys. Once a group exists those
   * disagree, so the same click said "Hide track 2" and recorded "Hide track 1".
   * Passing the rendered number keeps one answer instead of two derivations.
   */
  onToggleTrackHidden?: (
    track: number,
    hidden: boolean,
    displayNumber?: number | null,
  ) => Promise<void> | void;
  /** B7's bus strip: live-write the group's own attribute while dragging. */
  onSetAudioGroupAttributeLive?: (groupId: string, attr: string, value: string | null) => void;
  /** ...and persist one undo entry on release. */
  onSetAudioGroupAttributeQuiet?: (
    groupId: string,
    attr: string,
    value: string | null,
    label: string,
  ) => Promise<void>;
  /** C1's ungrouped-track FX pointer: "Group these clips" — write
   *  `data-audio-group` on every one of them, atomically. Same shape B6's
   *  carve auto-grouping uses. */
  onGroupClips?: (
    clipIds: readonly string[],
    groupId: string,
    groupLabel?: string,
  ) => Promise<void>;
  /** C1's single-clip FX write: addressed by the clip itself rather than the
   *  current selection, mirroring `onSetAudioGroupAttributeLive/Quiet`. */
  onSetElementAttributeLive?: (
    element: TimelineElement,
    attr: string,
    value: string | null,
  ) => void;
  onSetElementAttributeQuiet?: (
    element: TimelineElement,
    attr: string,
    value: string | null,
    label: string,
  ) => Promise<void>;
  onBlockedEditAttempt?: (element: TimelineElement, intent: BlockedTimelineEditIntent) => void;
  onSplitElement?: (element: TimelineElement, splitTime: number) => Promise<void> | void;
  onRazorSplit?: (element: TimelineElement, splitTime: number) => Promise<void> | void;
  onRazorSplitAll?: (splitTime: number) => Promise<void> | void;
  onDeleteKeyframe?: (elementId: string, keyframe: TimelineKeyframeTarget) => void;
  onDeleteAllKeyframes?: (element: TimelineElement, animationId?: string) => void;
  onMoveKeyframeToPlayhead?: (element: TimelineElement, keyframe: TimelineKeyframeTarget) => void;
  /** Drag-to-retime: `keyframe` identifies the dragged keyframe (its percentage
   *  is clip-relative), `toClipPercentage` is the neighbour-clamped drop. */
  onMoveKeyframe?: (
    elementId: string,
    keyframe: TimelineKeyframeTarget,
    toClipPercentage: number,
  ) => Promise<boolean>;
  onToggleKeyframeAtPlayhead?: (element: TimelineElement) => void;
  onTogglePropertyGroupKeyframe?: (
    element: TimelineElement,
    target: TimelinePropertyGroupKeyframeToggle,
  ) => Promise<void> | void;
}
