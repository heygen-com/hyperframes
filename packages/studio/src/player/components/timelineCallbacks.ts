// fallow-ignore-file code-duplication
// fallow-ignore-file dead-code
import type { TimelineElement } from "../store/playerStore";
import type { TimelineMoveOperation } from "../../hooks/timelineMoveAdapter";
import type { BlockedTimelineEditIntent } from "./timelineEditing";

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
  onToggleTrackHidden?: (track: number, hidden: boolean) => Promise<void> | void;
  onBlockedEditAttempt?: (element: TimelineElement, intent: BlockedTimelineEditIntent) => void;
  onSplitElement?: (element: TimelineElement, splitTime: number) => Promise<void> | void;
  onRazorSplit?: (element: TimelineElement, splitTime: number) => Promise<void> | void;
  onRazorSplitAll?: (splitTime: number) => Promise<void> | void;
  onDeleteKeyframe?: (elementId: string, percentage: number) => void;
  onDeleteAllKeyframes?: (elementId: string) => void;
  onChangeKeyframeEase?: (elementId: string, percentage: number, ease: string) => void;
  onMoveKeyframeToPlayhead?: (elementId: string, percentage: number) => void;
  onMoveKeyframe?: (
    elementId: string,
    fromClipPercentage: number,
    toClipPercentage: number,
  ) => void;
  onToggleKeyframeAtPlayhead?: (element: TimelineElement) => void;
}
