import { editabilityForProvenance, type GsapAnimation } from "@hyperframes/core/gsap-parser";

export type GsapEditBlockReason = "no-selector" | "unroll-required" | "source-uneditable";

export type GsapEditOutcome =
  | {
      status: "persisted";
      /**
       * Whether this edit already accounted for where the gesture left the
       * element, so the caller must not persist the drag offset on top.
       *
       * The scale route needs it: a committed scale renders around the element
       * centre rather than the dragged corner, so it measures the difference
       * and writes the position itself. Every other route moves nothing the
       * caller has not already been told about, and the caller owns the offset.
       *
       * It has to be reported rather than inferred. The caller used to guess
       * from "does this element have a scale-group tween", which is true for an
       * element whose scale is an instant hold — but that resize commits
       * width/height, not scale, so the guess withheld an offset nobody wrote
       * and the element snapped back to its authored position on every drag.
       */
      ownsDragOffset?: boolean;
    }
  | { status: "blocked"; reason: GsapEditBlockReason };

const COPY: Record<GsapEditBlockReason, string> = {
  "no-selector": "This layer needs a stable selector before Studio can save the edit.",
  "unroll-required":
    "This motion comes from a helper or loop. Choose Unroll to edit it explicitly.",
  "source-uneditable": "This animation is computed at runtime. Edit the animation in the Code tab.",
};

export class GsapEditBlockedError extends Error {
  constructor(readonly reason: GsapEditBlockReason) {
    super(COPY[reason]);
    this.name = "GsapEditBlockedError";
  }
}

export function assertGsapEditPersisted(outcome: GsapEditOutcome): void {
  if (outcome.status === "blocked") throw new GsapEditBlockedError(outcome.reason);
}

function assertGsapAnimationDirectlyEditable(animation: GsapAnimation): void {
  const editability = editabilityForProvenance(animation.provenance);
  if (editability === "unroll") throw new GsapEditBlockedError("unroll-required");
  if (
    editability === "source" ||
    animation.hasUnresolvedKeyframes ||
    animation.hasUnresolvedSelector
  ) {
    throw new GsapEditBlockedError("source-uneditable");
  }
}

export function isGsapEditBlockedError(error: unknown): error is GsapEditBlockedError {
  return error instanceof GsapEditBlockedError;
}

export function animationWritesAnyProperty(
  animation: GsapAnimation,
  properties: ReadonlySet<string>,
): boolean {
  return (
    Object.keys(animation.properties ?? {}).some((property) => properties.has(property)) ||
    Object.keys(animation.fromProperties ?? {}).some((property) => properties.has(property)) ||
    !!animation.keyframes?.keyframes.some((keyframe) =>
      Object.keys(keyframe.properties).some((property) => properties.has(property)),
    )
  );
}

/** Fail-closed ownership check shared by drag, resize, rotate, and inspector edits. */
export function directEditOutcomeForProperties(
  animations: GsapAnimation[],
  properties: ReadonlySet<string>,
): GsapEditOutcome {
  try {
    for (const animation of animations) {
      if (animationWritesAnyProperty(animation, properties)) {
        assertGsapAnimationDirectlyEditable(animation);
      }
    }
    return { status: "persisted" };
  } catch (error) {
    if (isGsapEditBlockedError(error)) return { status: "blocked", reason: error.reason };
    throw error;
  }
}
