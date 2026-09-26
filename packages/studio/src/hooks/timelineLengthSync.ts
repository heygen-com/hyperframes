import { usePlayerStore } from "../player/store/playerStore";
import {
  furthestClipEndFromDocument,
  parseCompositionSource,
} from "../player/lib/timelineElementHelpers";
import { readDocumentRootDuration } from "../utils/rootDuration";
import { writeRootLength } from "../utils/timelineAssetDrop";
import { persistSdkSerialize, type CutoverDeps } from "../utils/sdkEditTransaction";
import { readProjectFileContent, type RecordEditInput } from "../utils/studioFileHistory";
import {
  isPreviewedFile,
  patchDocumentRootDuration,
  readLiveAnimationEnd,
  type LengthAfterEdit,
} from "./timelineEditingGsap";

/** Best-effort live-iframe wrapper for patchDocumentRootDuration (see timelineEditingGsap). */
function patchIframeRootDuration(iframe: HTMLIFrameElement | null, contentEnd: number): void {
  try {
    patchDocumentRootDuration(iframe?.contentDocument ?? null, contentEnd);
  } catch {
    // Cross-origin or mid-navigation — file save is enqueued; iframe patch is best-effort.
  }
}

/** Keep the duration readout and live root on the decided length (null: the length as it is). */
export function syncPreviewContentDuration(
  iframe: HTMLIFrameElement | null,
  next: number | null,
): void {
  const length = next ?? readDocumentRootDuration(iframe?.contentDocument);
  if (length == null || !(length > 0)) return;
  usePlayerStore.getState().setDuration(length);
  patchIframeRootDuration(iframe, length);
}

/** Restore both store and live-root duration when a timing persist fails. */
export function captureDurationRollback(iframe: HTMLIFrameElement | null): () => void {
  const previousDuration = usePlayerStore.getState().duration;
  return () => {
    if (usePlayerStore.getState().duration === previousDuration) return;
    usePlayerStore.getState().setDuration(previousDuration);
    patchIframeRootDuration(iframe, previousDuration);
  };
}

/** What a timing edit captured at its start to re-decide the length once the preview converged. */
export interface LengthSync {
  lengthAfterEdit: LengthAfterEdit;
  activeCompPath: string | null;
  writeProjectFile: CutoverDeps["writeProjectFile"];
}

/**
 * Re-decide the previewed file's length from the converged animation end and write it, folded
 * into the gesture's undo step. Unconverged, or when another writer changed the length since the
 * gesture's own write, the readout only takes the file's length. Failures log.
 */
export async function syncEditLength(input: {
  converged: boolean;
  iframe: HTMLIFrameElement | null;
  reloadPreview: () => void;
  projectId: string | null;
  targetPath: string;
  label: string;
  coalesceKey?: string;
  coalesceMs: number;
  recordEdit: (edit: RecordEditInput) => Promise<void>;
  lengthSync?: LengthSync;
}): Promise<void> {
  const { iframe, projectId, targetPath, lengthSync } = input;
  if (!lengthSync || !projectId || !isPreviewedFile(targetPath, lengthSync.activeCompPath)) return;
  const decided: { next?: number | null } = {};
  try {
    await persistSdkSerialize(
      (onDisk) => {
        const doc = parseCompositionSource(onDisk);
        const onDiskLength = readDocumentRootDuration(doc);
        if (!input.converged || !lengthSync.lengthAfterEdit.isOwnLength(onDiskLength, targetPath)) {
          decided.next = onDiskLength;
          return onDisk;
        }
        decided.next = lengthSync.lengthAfterEdit({
          clips: furthestClipEndFromDocument(doc),
          animation: readLiveAnimationEnd(iframe),
        });
        return writeRootLength(onDisk, decided.next);
      },
      targetPath,
      "",
      {
        editHistory: { recordEdit: input.recordEdit },
        writeProjectFile: lengthSync.writeProjectFile,
        reloadPreview: input.reloadPreview,
        readProjectFile: (path) => readProjectFileContent(projectId, path),
      },
      {
        label: input.label,
        coalesceKey: input.coalesceKey,
        coalesceMs: input.coalesceMs,
        skipRefresh: true,
      },
    );
  } catch (error) {
    console.error("[Timeline] Failed to sync the length after the edit", error);
    return;
  }
  if (decided.next != null) syncPreviewContentDuration(iframe, decided.next);
}
