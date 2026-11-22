import {
  readCssRotation,
  readCssRotationTarget,
  type CssRotationTarget,
} from "@hyperframes/core/runtime/css-rotation";
import { roundTo3 } from "../../utils/rounding";
import type { PatchOperation } from "../../utils/sourcePatcher";
import type { EditingDraftRotate } from "@hyperframes/core/runtime/editing-port";
import {
  readStudioRotation,
  restoreStudioRotation,
  type StudioRotationSnapshot,
} from "./manualEdits";
import { getOffsetDragGsap } from "./manualOffsetDrag";
import { endStudioManualEditGesture, isStudioManualEditGestureCurrent } from "./manualEditGesture";
import { drawPreviewDraft, endPreviewDraft } from "./previewDrafts";

export type { CssRotationTarget };
export type PressChoseGsap = null;
export type RotationCommit = { angle: number; plain?: CssRotationTarget | PressChoseGsap };

export { readCssRotationTarget };

const cssTurn = (angle: number, target: CssRotationTarget) =>
  roundTo3(target.sign * (angle - target.share));

const frameTurn = (angle: number, plain: CssRotationTarget | null): EditingDraftRotate => {
  if (!plain) return { angle, route: "gsap" };
  const turn = cssTurn(angle, plain);
  return plain.property === "rotate"
    ? { angle: turn, route: "css" }
    : { angle: turn, route: "transform", value: turnedTransform(turn, plain) };
};

const turnedTransform = (turn: number, target: CssRotationTarget) =>
  [target.before, `rotate(${turn}deg)`, target.after].filter(Boolean).join(" ");

/** Draws `angle` where `target` says, and returns the source patches that save it as drawn. */
export function applyCssRotation(
  element: HTMLElement,
  angle: number,
  target = readCssRotationTarget(element),
): Array<PatchOperation & { value: string }> {
  const turn = cssTurn(angle, target);
  const value = target.property === "rotate" ? `${turn}deg` : turnedTransform(turn, target);
  const patches: Array<PatchOperation & { value: string }> = [
    { type: "inline-style", property: target.property, value },
  ];
  if (target.inline) {
    patches.unshift({ type: "inline-style", property: "display", value: "inline-block" });
  }
  for (const patch of patches) element.style.setProperty(patch.property, patch.value);
  return patches;
}

/** Back to the press: the rotation snapshot and, for a plain rotate, the inline transform it drew in. */
export function restorePlainRotation(element: HTMLElement, snapshot: StudioRotationSnapshot): void {
  restoreStudioRotation(element, snapshot);
  element.style.setProperty("transform", snapshot.transform);
  element.style.setProperty("display", snapshot.display);
}

// `plain`, read at press: where a turn GSAP does not own draws; null for GSAP's rotation.
export function applyRotationDraft(
  element: HTMLElement,
  angle: number,
  plain: CssRotationTarget | null,
): void {
  drawPreviewDraft(element, { rotate: frameTurn(angle, plain) });
  if (plain) return void applyCssRotation(element, angle, plain);
  element.style.setProperty("rotate", "none");
  getOffsetDragGsap(element)?.set(element, { rotation: angle });
}

export const endRotationDraft = (element: HTMLElement) => endPreviewDraft(element, "keep");

export function endRotationGestureIfCurrent(element: HTMLElement, token: string | undefined): void {
  if (!token || isStudioManualEditGestureCurrent(element, token)) endRotationDraft(element);
  endStudioManualEditGesture(element, token);
}

/** Back to the gesture start: the CSS snapshot, and GSAP's rotation without the legacy var. */
export function restoreRotationDraft(
  element: HTMLElement,
  angle: number,
  snapshot: StudioRotationSnapshot,
  plain: boolean,
): void {
  drawPreviewDraft(element, { rotate: null });
  endRotationDraft(element);
  if (plain) return restorePlainRotation(element, snapshot);
  getOffsetDragGsap(element)?.set(element, {
    rotation: angle - (Number.parseFloat(snapshot.studioRotation) || 0),
  });
  restoreStudioRotation(element, snapshot);
}

/** The angle a rotate gesture starts from, as the element shows it. */
export function readRotationBase(
  element: HTMLElement,
  plain: boolean,
  frameGsapRotation?: number,
): number {
  if (plain) return readCssRotation(element);
  const gsapRotation =
    frameGsapRotation ?? Number(getOffsetDragGsap(element)?.getProperty(element, "rotation") ?? 0);
  return gsapRotation + readStudioRotation(element).angle;
}
