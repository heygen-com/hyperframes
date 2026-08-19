import type { FrameStatus } from "@hyperframes/core/storyboard";

export type StoryboardReviewStage =
  | "empty"
  | "plan-review"
  | "sketch-in-progress"
  | "sketch-review"
  | "animation-in-progress"
  | "final-review";

export interface StoryboardReviewSummary {
  stage: StoryboardReviewStage;
  counts: Record<FrameStatus, number>;
  frameCount: number;
}

export type StoryboardHandoffStep = 1 | 2 | 3;

/** Current user action in the Studio → agent feedback handoff. */
export function deriveStoryboardHandoffStep(
  draftCount: number,
  pendingCount: number,
): StoryboardHandoffStep {
  if (draftCount > 0) return 2;
  if (pendingCount > 0) return 3;
  return 1;
}

/** Derive the board-level review moment from agent-owned frame statuses. */
export function deriveStoryboardReviewStage(
  frames: ReadonlyArray<{ status: FrameStatus }>,
): StoryboardReviewSummary {
  const counts: Record<FrameStatus, number> = { outline: 0, built: 0, animated: 0 };
  for (const frame of frames) counts[frame.status] += 1;

  let stage: StoryboardReviewStage;
  if (frames.length === 0) stage = "empty";
  else if (counts.outline === frames.length) stage = "plan-review";
  else if (counts.outline > 0) stage = "sketch-in-progress";
  else if (counts.built === frames.length) stage = "sketch-review";
  else if (counts.built > 0) stage = "animation-in-progress";
  else stage = "final-review";

  return { stage, counts, frameCount: frames.length };
}
