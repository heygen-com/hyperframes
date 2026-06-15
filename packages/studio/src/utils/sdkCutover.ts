import type { MutableRefObject } from "react";
import type { Composition, EditOp, GsapTweenSpec } from "@hyperframes/sdk";
import type { DomEditSelection } from "../components/editor/domEditing";
import type { EditHistoryKind } from "./editHistory";
import type { PatchOperation } from "./sourcePatcher";
import { STUDIO_SDK_CUTOVER_ENABLED } from "../components/editor/manualEditingAvailability";
import { trackStudioEvent } from "./studioTelemetry";

const CUTOVER_OP_TYPES = new Set<PatchOperation["type"]>([
  "inline-style",
  "text-content",
  "attribute",
  "html-attribute",
]);

/**
 * Map Studio PatchOperations for a given hf-id to SDK EditOps.
 *
 * Multiple inline-style ops are coalesced into a single setStyle (SDK batches
 * style changes naturally). One SDK op is emitted per non-style op.
 */
function patchOpsToSdkEditOps(hfId: string, ops: PatchOperation[]): EditOp[] {
  const result: EditOp[] = [];
  const styles: Record<string, string | null> = {};
  let hasStyles = false;

  for (const op of ops) {
    if (op.type === "inline-style") {
      styles[op.property] = op.value;
      hasStyles = true;
    } else if (op.type === "text-content") {
      result.push({ type: "setText", target: hfId, value: op.value ?? "" });
    } else if (op.type === "attribute") {
      result.push({
        type: "setAttribute",
        target: hfId,
        name: op.property.startsWith("data-") ? op.property : `data-${op.property}`,
        value: op.value,
      });
    } else if (op.type === "html-attribute") {
      result.push({ type: "setAttribute", target: hfId, name: op.property, value: op.value });
    }
  }

  if (hasStyles) {
    result.unshift({ type: "setStyle", target: hfId, styles });
  }

  return result;
}

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

// ponytail: internal; export only if a third caller appears
async function persistSdkSerialize(
  sdkSession: Composition,
  targetPath: string,
  originalContent: string,
  deps: CutoverDeps,
  options?: CutoverOptions,
): Promise<void> {
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
    await persistSdkSerialize(sdkSession, targetPath, originalContent, deps, options);
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

export async function sdkTimingPersist(
  hfId: string,
  targetPath: string,
  timingUpdate: { start?: number; duration?: number; trackIndex?: number },
  sdkSession: Composition | null | undefined,
  deps: CutoverDeps,
  options?: CutoverOptions,
): Promise<boolean> {
  if (!sdkSession || !sdkSession.getElement(hfId)) return false;
  try {
    const before = sdkSession.serialize();
    sdkSession.setTiming(hfId, timingUpdate);
    await persistSdkSerialize(sdkSession, targetPath, before, deps, options);
    trackStudioEvent("sdk_cutover_success", { hfId, opCount: 1 });
    return true;
  } catch (err) {
    trackStudioEvent("sdk_cutover_fallback", { hfId, error: String(err) });
    return false;
  }
}

type SdkGsapTweenOp =
  | { kind: "add"; target: string; spec: GsapTweenSpec }
  | { kind: "set"; animationId: string; properties: Partial<GsapTweenSpec> }
  | { kind: "remove"; animationId: string };

export async function sdkGsapTweenPersist(
  targetPath: string,
  op: SdkGsapTweenOp,
  sdkSession: Composition | null | undefined,
  deps: CutoverDeps,
  options?: CutoverOptions,
): Promise<boolean> {
  if (!sdkSession) return false;
  try {
    const before = sdkSession.serialize();
    if (op.kind === "add") {
      if (!sdkSession.getElement(op.target)) return false;
      sdkSession.addGsapTween(op.target, op.spec);
    } else if (op.kind === "set") {
      sdkSession.setGsapTween(op.animationId, op.properties);
    } else {
      sdkSession.removeGsapTween(op.animationId);
    }
    await persistSdkSerialize(sdkSession, targetPath, before, deps, options);
    trackStudioEvent("sdk_cutover_success", { opCount: 1 });
    return true;
  } catch (err) {
    trackStudioEvent("sdk_cutover_fallback", { error: String(err) });
    return false;
  }
}

export async function sdkDeletePersist(
  hfId: string,
  originalContent: string,
  targetPath: string,
  sdkSession: Composition | null | undefined,
  deps: CutoverDeps,
): Promise<boolean> {
  if (!sdkSession || !sdkSession.getElement(hfId)) return false;
  try {
    sdkSession.removeElement(hfId);
    await persistSdkSerialize(sdkSession, targetPath, originalContent, deps, {
      label: "Delete element",
    });
    trackStudioEvent("sdk_cutover_success", { hfId, opCount: 1 });
    return true;
  } catch (err) {
    trackStudioEvent("sdk_cutover_fallback", { hfId, error: String(err) });
    return false;
  }
}
