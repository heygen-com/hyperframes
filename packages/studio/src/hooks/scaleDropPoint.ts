import { clearStudioBoxSize } from "../components/editor/manualEdits";
import { setElementGsapPosition, setElementGsapScale } from "../utils/elementGsap";
import { roundTo3 } from "../utils/rounding";
import { logResize } from "../utils/resizeDebug";
import {
  drawFramePosition,
  frameBoxCentre,
  frameCentreScaledAt,
  sealedScaleFrame,
  type SealedScaleFrame,
} from "./scaleDropOnFrame";

function rectCentre(rect: DOMRect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

type ScaleDrop = { base: Point; corrected: Point; residual: Point };
type Point = { x: number; y: number };

/** Where the scale route's committed box lands against the drop point; "settled" when already on it. */
function scaleDropCorrection(
  dropPoint: Point,
  post: Point,
  base: Point,
  gsapPos: Point,
): ScaleDrop | "settled" | null {
  const residual = { x: dropPoint.x - post.x, y: dropPoint.y - post.y };
  if (!Number.isFinite(residual.x) || !Number.isFinite(residual.y)) return null;
  // The ONE corrected position — rounded once so the live runtime and the
  // persisted file agree exactly (commitStaticGsapPosition composes the same
  // rounded value from this delta).
  const corrected = { x: roundTo3(base.x + residual.x), y: roundTo3(base.y + residual.y) };
  if (corrected.x === roundTo3(base.x) && corrected.y === roundTo3(base.y)) {
    logResize("scale-finalize", { skipped: "already-on-drop-point", residual, base });
    return "settled";
  }
  logResize("scale-finalize", { dropPoint, post, residual, gsapPos, base, corrected });
  return { base, corrected, residual };
}

export async function dropPointOf(
  el: HTMLElement | null,
  standIn: Element,
  draw: <T>(run: () => T) => T,
): Promise<Point | null> {
  if (el) return draw(() => rectCentre(el.getBoundingClientRect()));
  const frame = sealedScaleFrame(standIn);
  return frame ? frameBoxCentre(frame) : null;
}

export function correctOnElement(
  draftEl: HTMLElement,
  committedScale: Point | null,
  dropPoint: Point,
  { base, gsapPos }: { base: Point; gsapPos: Point },
): ScaleDrop | "settled" | null {
  clearStudioBoxSize(draftEl);
  // Draw the committed scale before measuring: on a first resize the timeline has not re-seeked yet,
  // so the box would read at its natural size and the correction would be skipped.
  if (committedScale) setElementGsapScale(draftEl, committedScale.x, committedScale.y);
  setElementGsapPosition(draftEl, base.x, base.y);
  const found = scaleDropCorrection(
    dropPoint,
    rectCentre(draftEl.getBoundingClientRect()),
    base,
    gsapPos,
  );
  // Correct the live box in the same task as the measurement, so no frame shows it off the drop
  // point while the position write is in flight.
  if (found && found !== "settled")
    setElementGsapPosition(draftEl, found.corrected.x, found.corrected.y);
  return found;
}

export async function correctOnFrame(
  frame: SealedScaleFrame,
  scale: Point,
  dropPoint: Point,
  { base, gsapPos }: { base: Point; gsapPos: Point },
): Promise<ScaleDrop | "settled" | null> {
  const post = await frameCentreScaledAt(frame, scale, base);
  const found = post && scaleDropCorrection(dropPoint, post, base, gsapPos);
  if (found && found !== "settled") await drawFramePosition(frame, found.corrected);
  return found;
}
