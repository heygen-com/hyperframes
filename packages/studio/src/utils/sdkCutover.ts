import type { MutableRefObject } from "react";
import type { Composition } from "@hyperframes/sdk";
import type { DomEditSelection } from "../components/editor/domEditing";
import type { EditHistoryKind } from "./editHistory";
import type { PatchOperation } from "./sourcePatcher";
import { STUDIO_SDK_CUTOVER_ENABLED } from "../components/editor/manualEditingAvailability";
import { patchOpsToSdkEditOps } from "./sdkShadow";
import { trackStudioEvent } from "./studioTelemetry";

const CUTOVER_OP_TYPES = new Set<PatchOperation["type"]>([
  "inline-style",
  "text-content",
  "attribute",
  "html-attribute",
]);

export function shouldUseSdkCutover(
  flagEnabled: boolean,
  hasSession: boolean,
  hfId: string | null | undefined,
  ops: PatchOperation[],
): boolean {
  return (
    flagEnabled &&
    hasSession &&
    !!hfId &&
    ops.length > 0 &&
    ops.every((o) => CUTOVER_OP_TYPES.has(o.type))
  );
}

interface CutoverDeps {
  editHistory: {
    recordEdit: (entry: {
      label: string;
      kind: EditHistoryKind;
      coalesceKey?: string;
      files: Record<string, { before: string; after: string }>;
    }) => Promise<void>;
  };
  writeProjectFile: (path: string, content: string) => Promise<void>;
  reloadPreview: () => void;
  domEditSaveTimestampRef: MutableRefObject<number>;
}

interface CutoverOptions {
  label?: string;
  coalesceKey?: string;
}

export async function sdkCutoverPersist(
  selection: DomEditSelection,
  ops: PatchOperation[],
  originalContent: string,
  targetPath: string,
  sdkSession: Composition | null | undefined,
  deps: CutoverDeps,
  options?: CutoverOptions,
): Promise<boolean> {
  if (!shouldUseSdkCutover(STUDIO_SDK_CUTOVER_ENABLED, !!sdkSession, selection.hfId, ops))
    return false;
  if (!sdkSession) return false;
  const hfId = selection.hfId;
  if (!hfId) return false;
  if (!sdkSession.getElement(hfId)) return false;
  try {
    sdkSession.batch(() => {
      for (const editOp of patchOpsToSdkEditOps(hfId, ops)) {
        sdkSession.dispatch(editOp);
      }
    });
    const after = sdkSession.serialize();
    deps.domEditSaveTimestampRef.current = Date.now();
    await deps.writeProjectFile(targetPath, after);
    await deps.editHistory.recordEdit({
      label: options?.label ?? "Edit layer",
      kind: "manual",
      ...(options?.coalesceKey ? { coalesceKey: options.coalesceKey } : {}),
      files: { [targetPath]: { before: originalContent, after } },
    });
    deps.reloadPreview();
    trackStudioEvent("sdk_cutover_success", { hfId, opCount: ops.length });
    return true;
  } catch (err) {
    trackStudioEvent("sdk_cutover_fallback", {
      hfId: selection.hfId ?? null,
      error: String(err),
    });
    return false;
  }
}
