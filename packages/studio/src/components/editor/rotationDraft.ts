import { readCssRotation } from "../../hooks/draggedGsapPosition";
import { roundTo3 } from "../../utils/rounding";
import {
  readStudioRotation,
  restoreStudioRotation,
  type StudioRotationSnapshot,
} from "./manualEdits";
import { getOffsetDragGsap } from "./manualOffsetDrag";

/** The element's own `rotate` that shows `angle`, less `share`, what its `scale` and `transform` turn. */
export function applyCssRotation(
  element: HTMLElement,
  angle: number,
  share = readCssRotation(element, false),
): void {
  element.style.setProperty("rotate", `${roundTo3(angle - share)}deg`);
}

// `plainShare` is decided once, at gesture start: a number when GSAP turns nothing on the element (the
// rotate draws its own CSS `rotate`), null for GSAP's rotation, as the commit writes it.
export function applyRotationDraft(
  element: HTMLElement,
  angle: number,
  plainShare: number | null,
): void {
  const gsap = plainShare === null ? getOffsetDragGsap(element) : null;
  if (!gsap) return applyCssRotation(element, angle, plainShare ?? undefined);
  element.style.setProperty("rotate", "none");
  gsap.set(element, { rotation: angle });
}

const rotationGsap = (element: HTMLElement, plain: boolean) =>
  plain ? null : getOffsetDragGsap(element);

/** Back to the gesture start: the CSS snapshot, and GSAP's rotation without the legacy var. */
export function restoreRotationDraft(
  element: HTMLElement,
  angle: number,
  snapshot: StudioRotationSnapshot,
  plain: boolean,
): void {
  rotationGsap(element, plain)?.set(element, {
    rotation: angle - (Number.parseFloat(snapshot.studioRotation) || 0),
  });
  restoreStudioRotation(element, snapshot);
}

/** The angle a rotate gesture starts from, as the element shows it. */
export function readRotationBase(element: HTMLElement, plain: boolean): number {
  const gsap = rotationGsap(element, plain);
  if (!gsap) return readCssRotation(element);
  return Number(gsap.getProperty(element, "rotation")) + readStudioRotation(element).angle;
}
