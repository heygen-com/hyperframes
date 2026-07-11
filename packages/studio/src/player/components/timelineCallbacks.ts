// fallow-ignore-file code-duplication
// fallow-ignore-file dead-code
import type { TimelineElement } from "../store/playerStore";
import type { BlockedTimelineEditIntent, TimelineStackingReorderIntent } from "./timelineEditing";
import type {
  TimelineGroupCommitOptions,
  TimelineGroupMoveChange,
  TimelineGroupResizeChange,
} from "../../hooks/useTimelineGroupEditing";

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
    updates: Pick<TimelineElement, "start" | "track"> & {
      stackingReorder?: TimelineStackingReorderIntent | null;
    },
  ) => Promise<void> | void;
  onResizeElement?: (
    element: TimelineElement,
    updates: Pick<TimelineElement, "start" | "duration" | "playbackStart">,
  ) => Promise<void> | void;
  /**
   * Batched move. Method syntax (bivariant) + union parameter so both the
   * legacy group-editing shape (TimelineGroupMoveChange) and the NLE edit
   * shape (TimelineGroupMoveEdit) type-check while both engines coexist.
   */
  onMoveElements?(
    changes: Array<TimelineGroupMoveChange | TimelineGroupMoveEdit>,
    options?: TimelineGroupCommitOptions,
  ): Promise<void> | void;
  onResizeElements?: (
    changes: TimelineGroupResizeChange[],
    options?: TimelineGroupCommitOptions,
  ) => Promise<void> | void;
  onPreviewMoveElements?: (changes: TimelineGroupMoveChange[]) => void;
  onPreviewResizeElements?: (changes: TimelineGroupResizeChange[]) => void;
  onToggleTrackHidden?: (track: number, hidden: boolean) => Promise<void> | void;
  onToggleElementHidden?: (elementKey: string, hidden: boolean) => Promise<void> | void;
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

/**
 * NLE batched-move edit: the element plus exactly the fields the move changes.
 * The legacy engine's TimelineGroupMoveChange carries resolved absolute values
 * instead; onMoveElements accepts either while the engines coexist.
 */
export interface TimelineGroupMoveEdit {
  element: TimelineElement;
  updates: Pick<TimelineElement, "start" | "track">;
}
