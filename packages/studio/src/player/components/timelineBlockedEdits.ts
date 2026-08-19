import type { TimelineTrimMode } from "./timelineTrimOps";

/**
 * Why an attempted timeline edit did not start. The three original values mean
 * "the clip cannot take this edit at all"; the four trim-tool values mean "this
 * clip is the wrong shape for that operation" (see timelineTrimOps), which is a
 * different thing to tell the user.
 *
 * The intent and its message live together so a new blocked case cannot be
 * added without deciding what it says.
 */
export type BlockedTimelineEditIntent = "move" | "resize-start" | "resize-end" | TimelineTrimMode;

/** What to tell the user when a {@link BlockedTimelineEditIntent} is reported. */
export function blockedTimelineEditMessage(intent: BlockedTimelineEditIntent): string {
  switch (intent) {
    case "ripple":
      return "This clip can't be ripple-trimmed — it or a clip after it is locked.";
    case "roll":
      return "Rolling needs a clip butted against this edit point.";
    case "slip":
      return "Only clips with source media can be slipped.";
    case "slide":
      return "This clip can't be slid — it or a neighbour is locked.";
    default:
      return "This clip can't be moved or resized from the timeline yet.";
  }
}
