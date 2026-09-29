import { getDomEditTargetKey, type DomEditSelection } from "../components/editor/domEditing";
import {
  applyElementPositionOffset,
  type ElementOffsetRefusal,
} from "../components/editor/elementPositionOffset";
import { LAYER_REVEAL_PRIOR_POSITION_ATTR } from "../player/lib/timelineElementHelpers";
import type { PatchOperation } from "../utils/sourcePatcher";

const ELEMENT_OFFSET_REFUSED: Record<ElementOffsetRefusal, string> = {
  anchored: "This layer is anchored from its right or bottom edge. Move it in the Code tab.",
  percent: "This layer's position is set in percent. Move it in the Code tab.",
};

export interface ElementOffsetStagerDeps {
  commitPositionPatchToHtml: (
    selection: DomEditSelection,
    patches: PatchOperation[],
    options: { label: string; coalesceKey: string; coalesceMs?: number },
  ) => Promise<void>;
  showToast: (message: string, tone?: "error" | "info") => void;
  readOnlyPreview?: boolean;
}

/** The drag draft moved GSAP's x/y; left/top carries the move now, so put them back. */
function settleGsapDraftAtGestureStart(el: HTMLElement): void {
  const gsap = (el.ownerDocument.defaultView as { gsap?: { set: (t: Element, v: object) => void } })
    ?.gsap;
  const x = Number.parseFloat(el.getAttribute("data-hf-drag-gsap-base-x") ?? "");
  const y = Number.parseFloat(el.getAttribute("data-hf-drag-gsap-base-y") ?? "");
  if (gsap && Number.isFinite(x) && Number.isFinite(y)) gsap.set(el, { x, y });
}

/** Applies a shared-tween element's move live now; `save` persists it as left/top on that
 *  element, `rollback` takes the live move back. Throws, after a toast, when it cannot. */
export function stageElementOffset(
  { commitPositionPatchToHtml, showToast, readOnlyPreview }: ElementOffsetStagerDeps,
  selection: DomEditSelection,
  next: { x: number; y: number },
  coalesceKey?: string,
): { save: () => Promise<void>; rollback: () => void } {
  const el = selection.element;
  if (readOnlyPreview) return { save: () => Promise.resolve(), rollback: () => undefined };
  const previous = { position: el.style.position, left: el.style.left, top: el.style.top };
  const liftMarker = el.getAttribute(LAYER_REVEAL_PRIOR_POSITION_ATTR);
  const result = applyElementPositionOffset(el, next);
  if (!Array.isArray(result)) {
    showToast(ELEMENT_OFFSET_REFUSED[result], "error");
    throw new Error(ELEMENT_OFFSET_REFUSED[result]);
  }
  settleGsapDraftAtGestureStart(el);
  const rollback = () => {
    Object.assign(el.style, previous);
    if (liftMarker !== null) el.setAttribute(LAYER_REVEAL_PRIOR_POSITION_ATTR, liftMarker);
  };
  const save = () =>
    commitPositionPatchToHtml(selection, result, {
      label: "Move layer",
      coalesceKey: coalesceKey ?? `element-offset:${getDomEditTargetKey(selection)}`,
      ...(coalesceKey && { coalesceMs: Number.POSITIVE_INFINITY }),
    }).catch((error) => {
      rollback();
      throw error;
    });
  return { save, rollback };
}
