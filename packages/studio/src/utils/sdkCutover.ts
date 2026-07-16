import type { Composition, GsapTweenSpec } from "@hyperframes/sdk";
import type { DomEditSelection } from "../components/editor/domEditing";
import type { PatchOperation } from "./sourcePatcher";
import { STUDIO_SDK_CUTOVER_ENABLED } from "../components/editor/manualEditingAvailability";
import { trackStudioEvent } from "./studioTelemetry";
import { patchOpsToSdkEditOps } from "./sdkOpMapping";
import { recordResolverParity, recordAnimationResolverParity } from "./sdkResolverShadow";
import { shouldDeclineTextCutoverForTarget, shouldUseSdkCutover } from "./sdkCutoverEligibility";
import {
  asCutoverError,
  declinedCutover,
  persistSdkCandidateMutation,
  type CutoverDeps,
  type CutoverOptions,
  type CutoverResult,
} from "./sdkEditTransaction";

export { shouldUseSdkCutover } from "./sdkCutoverEligibility";
export {
  cutoverCommittedOrThrow,
  persistSdkCandidateMutation,
  persistSdkSerialize,
} from "./sdkEditTransaction";
export type {
  CutoverDeps,
  CutoverOptions,
  CutoverResult,
  PublishSdkSession,
} from "./sdkEditTransaction";

/** True when targetPath isn't the composition the SDK session models. */
function wrongCompositionFile(deps: CutoverDeps, targetPath: string): boolean {
  return deps.compositionPath != null && targetPath !== deps.compositionPath;
}

/**
 * Reader for the animation-resolver tripwire's disk-truth check: on an
 * animationId miss it re-parses the CURRENT file to distinguish a stale
 * session (panel ids re-derive from disk every render; session ids date from
 * the last reload) from a genuine resolver divergence.
 */
function gsapReadSource(
  deps: CutoverDeps,
  targetPath: string,
): (() => Promise<string | undefined>) | undefined {
  const read = deps.readProjectFile;
  return read ? () => read(targetPath) : undefined;
}
export async function sdkCutoverPersist(
  selection: DomEditSelection,
  ops: PatchOperation[],
  originalContent: string,
  targetPath: string,
  sdkSession: Composition | null | undefined,
  deps: CutoverDeps,
  options?: CutoverOptions,
): Promise<CutoverResult> {
  if (!shouldUseSdkCutover(STUDIO_SDK_CUTOVER_ENABLED, !!sdkSession, selection.hfId, ops))
    return declinedCutover("ineligible_operation");
  if (!sdkSession) return declinedCutover("session_unavailable");
  const hfId = selection.hfId;
  if (!hfId) return declinedCutover("target_unaddressable");
  const target = sdkSession.getElement(hfId);
  if (!target) return declinedCutover("target_not_found");
  if (shouldDeclineTextCutoverForTarget(target, ops))
    return declinedCutover("unsupported_text_target");
  if (wrongCompositionFile(deps, targetPath)) return declinedCutover("wrong_composition_file");
  const result = await persistSdkCandidateMutation(
    sdkSession,
    targetPath,
    originalContent,
    deps,
    (session) => {
      for (const editOp of patchOpsToSdkEditOps(hfId, ops)) session.dispatch(editOp);
    },
    options,
  );
  if (result.status === "committed") {
    trackStudioEvent("sdk_cutover_success", { hfId, opCount: ops.length });
  } else if (result.status === "failed") {
    trackStudioEvent("sdk_cutover_failed", { hfId, error: result.error.message });
  }
  return result;
}

export async function sdkTimingPersist(
  hfId: string,
  targetPath: string,
  timingUpdate: { start?: number; duration?: number; trackIndex?: number },
  sdkSession: Composition | null | undefined,
  deps: CutoverDeps,
  options?: CutoverOptions,
): Promise<CutoverResult> {
  // Resolver tripwire — runs BEFORE the cutover gate (decoupled): records when
  // the SDK can't resolve a target the server timing path is addressing.
  const timingSrc = deps.readProjectFile;
  void recordResolverParity(
    sdkSession,
    hfId,
    "setTiming",
    timingSrc ? () => timingSrc(targetPath) : undefined,
    { targetPath, compositionPath: deps.compositionPath },
  );
  // Dark-launch gate: without this, timing cutover runs whenever an SDK session
  // exists (it always does, for shadow/selection) — flipping the flag OFF would
  // NOT disable it. Gate here so flag-off routes back to the legacy server path.
  if (!STUDIO_SDK_CUTOVER_ENABLED) return declinedCutover("feature_disabled");
  if (!sdkSession) return declinedCutover("session_unavailable");
  if (!sdkSession.getElement(hfId)) return declinedCutover("target_not_found");
  if (wrongCompositionFile(deps, targetPath)) return declinedCutover("wrong_composition_file");
  try {
    const serializedBefore = sdkSession.serialize();
    const result = await persistSdkCandidateMutation(
      sdkSession,
      targetPath,
      serializedBefore,
      deps,
      (session) => session.setTiming(hfId, timingUpdate),
      options,
      serializedBefore,
    );
    if (result.status === "committed") {
      trackStudioEvent("sdk_cutover_success", { hfId, opCount: 1 });
    } else if (result.status === "failed") {
      trackStudioEvent("sdk_cutover_failed", { hfId, error: result.error.message });
    }
    return result;
  } catch (error) {
    const failed = { status: "failed", error: asCutoverError(error) } as const;
    trackStudioEvent("sdk_cutover_failed", { hfId, error: failed.error.message });
    return failed;
  }
}

export async function sdkTimingBatchPersist(
  changes: Array<{
    hfId: string;
    timingUpdate: { start?: number; duration?: number; trackIndex?: number };
  }>,
  targetPath: string,
  sdkSession: Composition | null | undefined,
  deps: CutoverDeps,
  options?: CutoverOptions,
): Promise<CutoverResult> {
  const timingSrc = deps.readProjectFile;
  for (const change of changes) {
    void recordResolverParity(
      sdkSession,
      change.hfId,
      "setTiming",
      timingSrc ? () => timingSrc(targetPath) : undefined,
      { targetPath, compositionPath: deps.compositionPath },
    );
  }
  if (!STUDIO_SDK_CUTOVER_ENABLED) return declinedCutover("feature_disabled");
  if (!sdkSession) return declinedCutover("session_unavailable");
  if (wrongCompositionFile(deps, targetPath)) return declinedCutover("wrong_composition_file");
  if (changes.some((change) => !sdkSession.getElement(change.hfId)))
    return declinedCutover("target_not_found");
  try {
    const serializedBefore = sdkSession.serialize();
    const result = await persistSdkCandidateMutation(
      sdkSession,
      targetPath,
      serializedBefore,
      deps,
      (session) => {
        for (const change of changes) session.setTiming(change.hfId, change.timingUpdate);
      },
      options,
      serializedBefore,
    );
    if (result.status === "failed") {
      trackStudioEvent("sdk_cutover_failed", {
        hfId: changes[0]?.hfId ?? null,
        error: result.error.message,
      });
      return result;
    }
    trackStudioEvent("sdk_cutover_success", {
      hfId: changes[0]?.hfId ?? null,
      opCount: changes.length,
    });
    return result;
  } catch (error) {
    const failed = { status: "failed", error: asCutoverError(error) } as const;
    trackStudioEvent("sdk_cutover_failed", {
      hfId: changes[0]?.hfId ?? null,
      error: failed.error.message,
    });
    return failed;
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
): Promise<CutoverResult> {
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
      { targetPath, compositionPath: deps.compositionPath },
    );
  } else {
    void recordAnimationResolverParity(
      sdkSession,
      op.animationId,
      op.kind === "set" ? "setGsapTween" : "removeGsapTween",
      gsapReadSource(deps, targetPath),
      { targetPath, compositionPath: deps.compositionPath },
    );
  }
  // Leading dark-launch gate so flag-off does no SDK touch (getElement) at all —
  // matches the other three chokepoints' discipline.
  if (!STUDIO_SDK_CUTOVER_ENABLED) return Promise.resolve(declinedCutover("feature_disabled"));
  if (op.kind === "add" && sdkSession && !sdkSession.getElement(op.target))
    return Promise.resolve(declinedCutover("target_not_found"));
  // dispatchGsapOpAndPersist declines on before===after — that catches stale
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
): Promise<CutoverResult> {
  // Resolver tripwire — runs BEFORE the cutover gate (decoupled): records when
  // the SDK can't resolve the animationId the server GSAP path is addressing.
  if (resolverTarget) {
    void recordAnimationResolverParity(
      sdkSession,
      resolverTarget.animationId,
      resolverTarget.opLabel,
      gsapReadSource(deps, targetPath),
      { targetPath, compositionPath: deps.compositionPath },
    );
  }
  // Dark-launch gate (shared chokepoint for every GSAP-op cutover persist):
  // flag OFF → explicit decline → caller falls back to the legacy server path.
  if (!STUDIO_SDK_CUTOVER_ENABLED) return declinedCutover("feature_disabled");
  if (!sdkSession) return declinedCutover("session_unavailable");
  if (wrongCompositionFile(deps, targetPath)) return declinedCutover("wrong_composition_file");
  const session = sdkSession;
  // persistSdkCandidateMutation owns the shared per-project/file transaction
  // coordinator used by both SDK and legacy GSAP writes.
  try {
    const serializedBefore = session.serialize();
    const result = await persistSdkCandidateMutation(
      session,
      targetPath,
      serializedBefore,
      deps,
      dispatch,
      options,
      serializedBefore,
    );
    if (result.status === "committed") {
      trackStudioEvent("sdk_cutover_success", { opCount: 1 });
    } else if (result.status === "failed") {
      trackStudioEvent("sdk_cutover_failed", { error: result.error.message });
    }
    return result;
  } catch (error) {
    const failed = { status: "failed", error: asCutoverError(error) } as const;
    trackStudioEvent("sdk_cutover_failed", { error: failed.error.message });
    return failed;
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
): Promise<CutoverResult> {
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
): Promise<CutoverResult> {
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
): Promise<CutoverResult> {
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
): Promise<CutoverResult> {
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
): Promise<CutoverResult> {
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
): Promise<CutoverResult> {
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
): Promise<CutoverResult> {
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
): Promise<CutoverResult> {
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
): Promise<CutoverResult> {
  // Resolver tripwire — runs BEFORE the cutover gate (decoupled).
  void recordResolverParity(
    sdkSession,
    hfId,
    "removeElement",
    () => Promise.resolve(originalContent),
    { targetPath, compositionPath: deps.compositionPath },
  );
  // Dark-launch gate: flag OFF → legacy server delete path.
  if (!STUDIO_SDK_CUTOVER_ENABLED) return declinedCutover("feature_disabled");
  if (!sdkSession) return declinedCutover("session_unavailable");
  if (!sdkSession.getElement(hfId)) return declinedCutover("target_not_found");
  if (wrongCompositionFile(deps, targetPath)) return declinedCutover("wrong_composition_file");
  const result = await persistSdkCandidateMutation(
    sdkSession,
    targetPath,
    originalContent,
    deps,
    (session) => session.removeElement(hfId),
    { label: "Delete element" },
  );
  if (result.status === "committed") {
    trackStudioEvent("sdk_cutover_success", { hfId, opCount: 1 });
  } else if (result.status === "failed") {
    trackStudioEvent("sdk_cutover_failed", { hfId, error: result.error.message });
  }
  return result;
}
