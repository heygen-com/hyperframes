import type { CommitMutationOptions } from "../../hooks/gsapScriptCommitTypes";
import { trackPreviewFeatureUsed, type PreviewMethod } from "../../utils/previewFeatureUsage";
/**
 * Commit helpers for the motion-path overlay. Each maps a canvas gesture to a
 * GSAP source mutation routed through the (selection-bound) commit facade, which
 * handles the soft reload, undo snapshot, and save-failure feedback.
 */
import type { MotionNodeRef } from "./motionPathGeometry";

export type CommitFn = (
  mutation: Record<string, unknown>,
  options: CommitMutationOptions,
) => Promise<void>;

const NEW_PATH_DURATION = 1.5;

function motionPathCommitOptions(label: string, method: PreviewMethod): CommitMutationOptions {
  return {
    label,
    softReload: true,
    onResult: (result) => {
      if (result.ok && result.changed !== false) trackPreviewFeatureUsed("motion_path", method);
    },
  };
}

export function commitNode(
  ref: MotionNodeRef,
  x: number,
  y: number,
  animationId: string,
  commit: CommitFn,
): Promise<void> {
  const mutation: Record<string, unknown> =
    ref.type === "keyframe"
      ? { type: "update-keyframe", animationId, percentage: ref.pct, properties: { x, y } }
      : { type: "update-motion-path-point", animationId, pointIndex: ref.index, x, y };
  return commit(
    mutation,
    motionPathCommitOptions(ref.type === "keyframe" ? "Move keyframe" : "Move waypoint", "drag"),
  );
}

export function commitAddWaypoint(
  animationId: string,
  index: number,
  x: number,
  y: number,
  commit: CommitFn,
): Promise<void> {
  return commit(
    { type: "add-motion-path-point", animationId, index, x, y },
    motionPathCommitOptions("Add waypoint", "button"),
  );
}

export function commitAddKeyframe(
  animationId: string,
  percentage: number,
  x: number,
  y: number,
  commit: CommitFn,
): Promise<void> {
  // percentage is tween-relative (matches MotionNodeRef.keyframe.pct). The parser's
  // addKeyframeToScript inserts a new "P%": { x, y } stop (or merges if one exists
  // at that pct) and converts a flat tween to keyframes form when needed.
  return commit(
    { type: "add-keyframe", animationId, percentage, properties: { x, y } },
    motionPathCommitOptions("Add keyframe", "button"),
  );
}

export function commitRemoveWaypoint(
  animationId: string,
  index: number,
  commit: CommitFn,
): Promise<void> {
  return commit(
    { type: "remove-motion-path-point", animationId, index },
    motionPathCommitOptions("Remove waypoint", "button"),
  );
}

export function commitCreatePath(
  targetSelector: string,
  position: number,
  x: number,
  y: number,
  commit: CommitFn,
): Promise<void> {
  return commit(
    { type: "add-motion-path", targetSelector, position, duration: NEW_PATH_DURATION, x, y },
    motionPathCommitOptions("Create motion path", "button"),
  );
}
