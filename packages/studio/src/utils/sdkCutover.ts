import type { MutableRefObject } from "react";
import type { Composition, GsapTweenSpec } from "@hyperframes/sdk";
import type { DomEditSelection } from "../components/editor/domEditing";
import type { EditHistoryKind } from "./editHistory";
import type { PatchOperation } from "./sourcePatcher";
import { STUDIO_SDK_CUTOVER_ENABLED } from "../components/editor/manualEditingAvailability";
import { trackStudioEvent } from "./studioTelemetry";
import { markSelfWrite } from "../hooks/sdkSelfWriteRegistry";
import { patchOpsToSdkEditOps } from "./sdkOpMapping";
import { recordResolverParity, recordAnimationResolverParity } from "./sdkResolverShadow";
import { shouldDeclineTextCutoverForTarget, shouldUseSdkCutover } from "./sdkCutoverEligibility";

export { shouldUseSdkCutover } from "./sdkCutoverEligibility";

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
  /**
   * Optional per-key task serializer (the same `gsap-file:${file}` serializer the
   * legacy `commitMutation` uses). When provided, every GSAP-op persist routes its
   * read-serialize → dispatch → serialize → write through it so two concurrent
   * same-file flushes can't interleave their read-modify-write and lose an edit.
   * Absent (e.g. in unit tests) → ops run unserialized as before.
   */
  serialize?: <T>(key: string, task: () => Promise<T>) => Promise<T>;
  /**
   * Optional reader for the on-disk content of targetPath. Timing/GSAP persists
   * use it to capture the EXACT prior bytes as the undo-history `before`, so undo
   * restores the file verbatim instead of a normalized SDK re-emit (which would
   * reformat the whole file). The style/delete paths already thread originalContent
   * in explicitly; this gives timing/GSAP parity without touching every call site.
   * Absent → falls back to the SDK's pre-edit serialize() (the prior behavior).
   */
  readProjectFile?: (path: string) => Promise<string>;
}

/**
 * Capture the undo-history `before` baseline for timing/GSAP persists: the exact
 * on-disk bytes when a reader is available (so undo restores them verbatim),
 * falling back to the SDK's pre-edit serialization when it isn't. Never throws —
 * a failed read degrades to the serialized fallback rather than aborting the edit.
 */
async function captureOnDiskBefore(
  deps: CutoverDeps,
  targetPath: string,
  serializedFallback: string,
): Promise<string> {
  if (!deps.readProjectFile) return serializedFallback;
  try {
    return await deps.readProjectFile(targetPath);
  } catch {
    return serializedFallback;
  }
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

// ponytail: exported for setSlideshowManifest (third caller — island write bypasses
// the SDK dispatch path since <script> nodes are not in the element tree).
// `after` is serialized once by the caller (which also did the no-op check
// against its pre-dispatch snapshot), so this never re-serializes.
export async function persistSdkSerialize(
  after: string,
  targetPath: string,
  originalContent: string,
  deps: CutoverDeps,
  options?: CutoverOptions,
): Promise<void> {
  deps.domEditSaveTimestampRef.current = Date.now();
  // Tag this write with the exact content (by hash) so the file-change
  // reload-suppression can recognize its own echo by IDENTITY, not just a 2 s
  // clock — an undo write (different bytes, not registered here) then always
  // reloads instead of being swallowed by the time window.
  markSelfWrite(targetPath, after);
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
  const target = sdkSession.getElement(hfId);
  if (!target) return false;
  if (shouldDeclineTextCutoverForTarget(target, ops)) return false;
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
  // Resolver tripwire — runs BEFORE the cutover gate (decoupled): records when
  // the SDK can't resolve a target the server timing path is addressing.
  const timingSrc = deps.readProjectFile;
  void recordResolverParity(
    sdkSession,
    hfId,
    "setTiming",
    timingSrc ? () => timingSrc(targetPath) : undefined,
  );
  // Dark-launch gate: without this, timing cutover runs whenever an SDK session
  // exists (it always does, for shadow/selection) — flipping the flag OFF would
  // NOT disable it. Gate here so flag-off routes back to the legacy server path.
  if (!STUDIO_SDK_CUTOVER_ENABLED) return false;
  if (!sdkSession || !sdkSession.getElement(hfId)) return false;
  if (wrongCompositionFile(deps, targetPath)) return false;
  try {
    const serializedBefore = sdkSession.serialize();
    sdkSession.batch(() => sdkSession.setTiming(hfId, timingUpdate));
    const after = sdkSession.serialize();
    if (after === serializedBefore) return false;
    // Undo baseline = exact on-disk bytes (matching the style/delete paths), so
    // undoing a timing edit restores the file verbatim instead of a normalized
    // full-DOM re-emit. Falls back to serializedBefore when no reader is wired.
    const undoBefore = await captureOnDiskBefore(deps, targetPath, serializedBefore);
    await persistSdkSerialize(after, targetPath, undoBefore, deps, options);
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
  // Resolver tripwire — runs BEFORE this function's own cutover gate (decoupled).
  // add targets an element (element-resolution parity); set/remove target an
  // animationId (animation-resolution parity). Done here, not via
  // dispatchGsapOpAndPersist's resolverTarget, because the gate below returns
  // before that call when cutover is off.
  if (op.kind === "add") {
    const gsapSrc = deps.readProjectFile;
    void recordResolverParity(
      sdkSession,
      op.target,
      "addGsapTween",
      gsapSrc ? () => gsapSrc(targetPath) : undefined,
    );
  } else
    recordAnimationResolverParity(
      sdkSession,
      op.animationId,
      op.kind === "set" ? "setGsapTween" : "removeGsapTween",
    );
  // Leading dark-launch gate so flag-off does no SDK touch (getElement) at all —
  // matches the other three chokepoints' discipline.
  if (!STUDIO_SDK_CUTOVER_ENABLED) return Promise.resolve(false);
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
  resolverTarget?: { animationId: string; opLabel: string },
): Promise<boolean> {
  // Resolver tripwire — runs BEFORE the cutover gate (decoupled): records when
  // the SDK can't resolve the animationId the server GSAP path is addressing.
  if (resolverTarget) {
    recordAnimationResolverParity(sdkSession, resolverTarget.animationId, resolverTarget.opLabel);
  }
  // Dark-launch gate (shared chokepoint for every GSAP-op cutover persist):
  // flag OFF → return false → caller falls back to the legacy server path.
  if (!STUDIO_SDK_CUTOVER_ENABLED) return false;
  if (!sdkSession) return false;
  if (wrongCompositionFile(deps, targetPath)) return false;
  const session = sdkSession;
  // Route the whole read-serialize → dispatch → serialize → write through the
  // per-file serializer (when provided) so overlapping same-file flushes can't
  // interleave their read-modify-write and drop an edit, matching the legacy
  // commitMutation path's `gsap-file:${file}` serialization.
  const run = async (): Promise<boolean> => {
    try {
      const serializedBefore = session.serialize();
      dispatch(session);
      const after = session.serialize();
      if (after === serializedBefore) return false;
      // Undo baseline = exact on-disk bytes (matching the style/delete paths), so
      // undoing a GSAP edit restores the file verbatim instead of a normalized
      // full-DOM re-emit. Falls back to serializedBefore when no reader is wired.
      const undoBefore = await captureOnDiskBefore(deps, targetPath, serializedBefore);
      await persistSdkSerialize(after, targetPath, undoBefore, deps, options);
      trackStudioEvent("sdk_cutover_success", { opCount: 1 });
      return true;
    } catch (err) {
      trackStudioEvent("sdk_cutover_fallback", { error: String(err) });
      return false;
    }
  };
  return deps.serialize ? deps.serialize(`gsap-file:${targetPath}`, run) : run();
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
  return dispatchGsapOpAndPersist(
    targetPath,
    sdkSession,
    deps,
    options,
    (s) => s.batch(() => s.dispatch({ type: "addGsapKeyframe", animationId, position, value })),
    { animationId, opLabel: "addGsapKeyframe" },
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
  return dispatchGsapOpAndPersist(
    targetPath,
    sdkSession,
    deps,
    options,
    (s) => s.dispatch({ type: "removeGsapKeyframe", animationId, percentage }),
    { animationId, opLabel: "removeGsapKeyframe" },
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
  return dispatchGsapOpAndPersist(
    targetPath,
    sdkSession,
    deps,
    options,
    (s) => s.dispatch({ type: "removeGsapProperty", animationId, property, from }),
    { animationId, opLabel: "removeGsapProperty" },
  );
}

export function sdkGsapDeleteAllForSelectorPersist(
  targetPath: string,
  selector: string,
  sdkSession: Composition | null | undefined,
  deps: CutoverDeps,
  options?: CutoverOptions,
): Promise<boolean> {
  return dispatchGsapOpAndPersist(targetPath, sdkSession, deps, options, (s) =>
    s.dispatch({ type: "deleteAllForSelector", selector }),
  );
}

export function sdkGsapRemoveAllKeyframesPersist(
  targetPath: string,
  animationId: string,
  sdkSession: Composition | null | undefined,
  deps: CutoverDeps,
  options?: CutoverOptions,
): Promise<boolean> {
  return dispatchGsapOpAndPersist(
    targetPath,
    sdkSession,
    deps,
    options,
    (s) => s.dispatch({ type: "removeAllKeyframes", animationId }),
    { animationId, opLabel: "removeAllKeyframes" },
  );
}

export function sdkGsapConvertToKeyframesPersist(
  targetPath: string,
  animationId: string,
  resolvedFromValues: Record<string, number | string> | undefined,
  sdkSession: Composition | null | undefined,
  deps: CutoverDeps,
  options?: CutoverOptions,
): Promise<boolean> {
  return dispatchGsapOpAndPersist(
    targetPath,
    sdkSession,
    deps,
    options,
    (s) => s.dispatch({ type: "convertToKeyframes", animationId, resolvedFromValues }),
    { animationId, opLabel: "convertToKeyframes" },
  );
}

type KeyframeSpec = {
  percentage: number;
  properties: Record<string, number | string>;
  ease?: string;
  auto?: boolean;
};

type KeyframesPayload = {
  targetSelector: string;
  position: number;
  duration: number;
  keyframes: KeyframeSpec[];
  ease?: string;
};

/** Shared inner dispatch for addWithKeyframes / replaceWithKeyframes ops. */
function dispatchWithKeyframes(
  s: Composition,
  payload: KeyframesPayload,
  animationId?: string,
): void {
  if (animationId !== undefined) {
    s.dispatch({ type: "replaceWithKeyframes", animationId, ...payload });
  } else {
    s.dispatch({ type: "addWithKeyframes", ...payload });
  }
}

export function sdkAddWithKeyframesPersist(
  targetPath: string,
  targetSelector: string,
  position: number,
  duration: number,
  keyframes: KeyframeSpec[],
  ease: string | undefined,
  sdkSession: Composition | null | undefined,
  deps: CutoverDeps,
  options?: CutoverOptions,
): Promise<boolean> {
  const payload: KeyframesPayload = {
    targetSelector,
    position,
    duration,
    keyframes,
    ...(ease ? { ease } : {}),
  };
  return dispatchGsapOpAndPersist(targetPath, sdkSession, deps, options, (s) =>
    dispatchWithKeyframes(s, payload),
  );
}

export function sdkReplaceWithKeyframesPersist(
  targetPath: string,
  animationId: string,
  targetSelector: string,
  position: number,
  duration: number,
  keyframes: KeyframeSpec[],
  ease: string | undefined,
  sdkSession: Composition | null | undefined,
  deps: CutoverDeps,
  options?: CutoverOptions,
): Promise<boolean> {
  const payload: KeyframesPayload = {
    targetSelector,
    position,
    duration,
    keyframes,
    ...(ease ? { ease } : {}),
  };
  return dispatchGsapOpAndPersist(
    targetPath,
    sdkSession,
    deps,
    options,
    (s) => dispatchWithKeyframes(s, payload, animationId),
    { animationId, opLabel: "replaceWithKeyframes" },
  );
}

export async function sdkDeletePersist(
  hfId: string,
  originalContent: string,
  targetPath: string,
  sdkSession: Composition | null | undefined,
  deps: CutoverDeps,
): Promise<boolean> {
  // Resolver tripwire — runs BEFORE the cutover gate (decoupled).
  void recordResolverParity(sdkSession, hfId, "removeElement", () =>
    Promise.resolve(originalContent),
  );
  // Dark-launch gate: flag OFF → legacy server delete path.
  if (!STUDIO_SDK_CUTOVER_ENABLED) return false;
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
