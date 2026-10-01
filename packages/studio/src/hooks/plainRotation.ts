import type { DomEditSelection } from "../components/editor/domEditing";
import { captureStudioRotation, clearStudioRotation } from "../components/editor/manualEdits";
import { buildClearRotationPatches } from "../components/editor/manualEditsDomPatches";
import { STUDIO_ROTATION_ATTR } from "../components/editor/manualEditsTypes";
import { applyCssRotation, restorePlainRotation } from "../components/editor/rotationDraft";
import type { PatchOperation } from "../utils/sourcePatcher";
import type { ElementOffsetStagerDeps } from "./elementOffsetStager";

let plainRotateCounter = 0;

/** GSAP does not turn the element: `next` is its whole angle, drawn and saved as its CSS turn. */
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
  const drawn = applyCssRotation(element, next.angle);
  patches.push(...drawn);
  const turn = drawn.at(-1)!;
  return commitPositionPatchToHtml(selection, patches, {
    label: "Rotate layer",
    coalesceKey: `rotate:${++plainRotateCounter}`,
    coalesceMs: Number.POSITIVE_INFINITY,
  }).catch((error) => {
    if (element.style.getPropertyValue(turn.property) === turn.value) {
      restorePlainRotation(element, before);
    }
    throw error;
  });
}
