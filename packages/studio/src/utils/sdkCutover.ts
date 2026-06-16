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

export interface CutoverDeps {
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
  /**
   * Optional post-write refresh. When provided, it REPLACES the default
   * reloadPreview() — the GSAP path passes one that soft-reloads (preserving
   * the playhead) and invalidates the keyframe/gsap panel cache. Receives the
   * serialized document just written.
   */
  refresh?: (after: string) => void;
  /**
   * Path of the composition the SDK session was opened for. The session models
   * ONLY this file (serialize() emits the whole active composition), so any edit
   * whose targetPath differs (a sub-composition file) must take the server path
   * — otherwise we'd write the full active-comp serialization into that file.
   */
  compositionPath?: string | null;
}

/** True when targetPath isn't the composition the SDK session models. */
function wrongCompositionFile(deps: CutoverDeps, targetPath: string): boolean {
  return deps.compositionPath != null && targetPath !== deps.compositionPath;
}

interface CutoverOptions {
  label?: string;
  coalesceKey?: string;
  /** Skip the preview reload (mirrors the server path's skipRefresh). */
  skipRefresh?: boolean;
}

// ponytail: internal; export only if a third caller appears.
// `after` is serialized once by the caller (which also did the no-op check
// against its pre-dispatch snapshot), so this never re-serializes.
async function persistSdkSerialize(
  after: string,
  targetPath: string,
  originalContent: string,
  deps: CutoverDeps,
  options?: CutoverOptions,
): Promise<void> {
  deps.domEditSaveTimestampRef.current = Date.now();
  await deps.writeProjectFile(targetPath, after);
  await deps.editHistory.recordEdit({
    label: options?.label ?? "Edit layer",
    kind: "manual",
    ...(options?.coalesceKey ? { coalesceKey: options.coalesceKey } : {}),
    files: { [targetPath]: { before: originalContent, after } },
  });
  if (deps.refresh) deps.refresh(after);
  else if (!options?.skipRefresh) deps.reloadPreview();
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
  if (wrongCompositionFile(deps, targetPath)) return false;
  try {
    const before = sdkSession.serialize();
    sdkSession.batch(() => {
      for (const editOp of patchOpsToSdkEditOps(hfId, ops)) {
        sdkSession.dispatch(editOp);
      }
    });
    const after = sdkSession.serialize();
    if (after === before) return false;
    await persistSdkSerialize(after, targetPath, originalContent, deps, options);
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
  if (wrongCompositionFile(deps, targetPath)) return false;
  try {
    const before = sdkSession.serialize();
    sdkSession.batch(() => sdkSession.setTiming(hfId, timingUpdate));
    const after = sdkSession.serialize();
    if (after === before) return false;
    await persistSdkSerialize(after, targetPath, before, deps, options);
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

export function sdkGsapTweenPersist(
  targetPath: string,
  op: SdkGsapTweenOp,
  sdkSession: Composition | null | undefined,
  deps: CutoverDeps,
  options?: CutoverOptions,
): Promise<boolean> {
  if (op.kind === "add" && sdkSession && !sdkSession.getElement(op.target))
    return Promise.resolve(false);
  // dispatchGsapOpAndPersist returns false on before===after — that catches stale
  // animationIds and unsupported shapes (e.g. from-prop on a plain tween), falling
  // back to the server path. This subsumes explicit existence guards for set/remove.
  return dispatchGsapOpAndPersist(targetPath, sdkSession, deps, options, (s) => {
    s.batch(() => {
      if (op.kind === "add") {
        s.addGsapTween(op.target, op.spec);
      } else if (op.kind === "set") {
        s.setGsapTween(op.animationId, op.properties);
      } else {
        s.removeGsapTween(op.animationId);
      }
    });
  });
}

async function dispatchGsapOpAndPersist(
  targetPath: string,
  sdkSession: Composition | null | undefined,
  deps: CutoverDeps,
  options: CutoverOptions | undefined,
  dispatch: (s: Composition) => void,
): Promise<boolean> {
  if (!sdkSession) return false;
  if (wrongCompositionFile(deps, targetPath)) return false;
  try {
    const before = sdkSession.serialize();
    dispatch(sdkSession);
    const after = sdkSession.serialize();
    if (after === before) return false;
    await persistSdkSerialize(after, targetPath, before, deps, options);
    trackStudioEvent("sdk_cutover_success", { opCount: 1 });
    return true;
  } catch (err) {
    trackStudioEvent("sdk_cutover_fallback", { error: String(err) });
    return false;
  }
}

export function sdkGsapKeyframePersist(
  targetPath: string,
  animationId: string,
  position: number,
  value: Record<string, unknown>,
  sdkSession: Composition | null | undefined,
  deps: CutoverDeps,
  options?: CutoverOptions,
): Promise<boolean> {
  return dispatchGsapOpAndPersist(targetPath, sdkSession, deps, options, (s) =>
    s.batch(() => s.dispatch({ type: "addGsapKeyframe", animationId, position, value })),
  );
}

export function sdkGsapRemoveKeyframePersist(
  targetPath: string,
  animationId: string,
  percentage: number,
  sdkSession: Composition | null | undefined,
  deps: CutoverDeps,
  options?: CutoverOptions,
): Promise<boolean> {
  return dispatchGsapOpAndPersist(targetPath, sdkSession, deps, options, (s) =>
    s.dispatch({ type: "removeGsapKeyframe", animationId, percentage }),
  );
}

export function sdkGsapRemovePropertyPersist(
  targetPath: string,
  animationId: string,
  property: string,
  from: boolean,
  sdkSession: Composition | null | undefined,
  deps: CutoverDeps,
  options?: CutoverOptions,
): Promise<boolean> {
  return dispatchGsapOpAndPersist(targetPath, sdkSession, deps, options, (s) =>
    s.dispatch({ type: "removeGsapProperty", animationId, property, from }),
  );
}

export async function sdkDeletePersist(
  hfId: string,
  originalContent: string,
  targetPath: string,
  sdkSession: Composition | null | undefined,
  deps: CutoverDeps,
): Promise<boolean> {
  if (!sdkSession || !sdkSession.getElement(hfId)) return false;
  if (wrongCompositionFile(deps, targetPath)) return false;
  try {
    const before = sdkSession.serialize();
    sdkSession.batch(() => sdkSession.removeElement(hfId));
    const after = sdkSession.serialize();
    if (after === before) return false;
    await persistSdkSerialize(after, targetPath, originalContent, deps, {
      label: "Delete element",
    });
    trackStudioEvent("sdk_cutover_success", { hfId, opCount: 1 });
    return true;
  } catch (err) {
    trackStudioEvent("sdk_cutover_fallback", { hfId, error: String(err) });
    return false;
  }
}
