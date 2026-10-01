import type { DomEditSelection } from "../components/editor/domEditing";
import {
  captureStudioRotation,
  clearStudioRotation,
  restoreStudioRotation,
} from "../components/editor/manualEdits";
import { buildClearRotationPatches } from "../components/editor/manualEditsDomPatches";
import { STUDIO_ROTATION_ATTR } from "../components/editor/manualEditsTypes";
import { applyCssRotation } from "../components/editor/rotationDraft";
import type { PatchOperation } from "../utils/sourcePatcher";
import type { ElementOffsetStagerDeps } from "./elementOffsetStager";

let plainRotateCounter = 0;

/** GSAP does not turn the element: `next` is its whole angle, drawn and saved as its own `rotate`. */
export function savePlainRotation(
  { commitPositionPatchToHtml, readOnlyPreview }: Omit<ElementOffsetStagerDeps, "showToast">,
  selection: DomEditSelection,
  next: { angle: number },
): Promise<void> {
  if (readOnlyPreview) return Promise.resolve();
  const { element } = selection;
  const before = captureStudioRotation(element);
  // Legacy rotation marks go in the same write, or the seek re-apply would put their angle back.
  const patches: PatchOperation[] = element.hasAttribute(STUDIO_ROTATION_ATTR)
    ? buildClearRotationPatches(element)
    : [];
  if (patches.length) clearStudioRotation(element);
  applyCssRotation(element, next.angle);
  const value = element.style.getPropertyValue("rotate");
  patches.push({ type: "inline-style", property: "rotate", value });
  return commitPositionPatchToHtml(selection, patches, {
    label: "Rotate layer",
    coalesceKey: `rotate:${++plainRotateCounter}`,
    coalesceMs: Number.POSITIVE_INFINITY,
  }).catch((error) => {
    if (element.style.getPropertyValue("rotate") === value) restoreStudioRotation(element, before);
    throw error;
  });
}
