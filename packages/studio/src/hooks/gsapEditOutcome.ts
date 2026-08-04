import { editabilityForProvenance, type GsapAnimation } from "@hyperframes/core/gsap-parser";

export type GsapEditBlockReason = "no-selector" | "unroll-required" | "source-uneditable";

export type GsapEditOutcome =
  | { status: "persisted" }
  | { status: "blocked"; reason: GsapEditBlockReason };

export type GsapEditAction = "add-selector" | "unroll" | "open-code";

const COPY: Record<GsapEditBlockReason, { message: string; action: GsapEditAction }> = {
  "no-selector": {
    message: "This layer needs a stable selector before Studio can save its position.",
    action: "add-selector",
  },
  "unroll-required": {
    message: "This motion comes from a helper or loop. Choose Unroll to edit it explicitly.",
    action: "unroll",
  },
  "source-uneditable": {
    message: "This position is computed at runtime. Edit the animation in the Code tab.",
    action: "open-code",
  },
};

export class GsapEditBlockedError extends Error {
  readonly action: GsapEditAction;

  constructor(readonly reason: GsapEditBlockReason) {
    super(COPY[reason].message);
    this.name = "GsapEditBlockedError";
    this.action = COPY[reason].action;
  }
}

export function assertGsapEditPersisted(outcome: GsapEditOutcome): void {
  if (outcome.status === "blocked") throw new GsapEditBlockedError(outcome.reason);
}

export function assertGsapAnimationDirectlyEditable(animation: GsapAnimation): void {
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
