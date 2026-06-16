import { useCallback, useRef } from "react";
import { findUnsafeMutationValues } from "@hyperframes/core/studio-api/finite-mutation";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { applySoftReload } from "../utils/gsapSoftReload";
import { resolveGsapFidelityArgs, runShadowGsapFidelity } from "../utils/sdkShadowGsapFidelity";
import { runShadowGsapKeyframeFidelity } from "../utils/sdkShadowGsapKeyframe";
import { updateKeyframeCacheFromParsed } from "./gsapKeyframeCacheHelpers";
import { createKeyedSerializer } from "./serializeByKey";
import {
  GsapMutationHttpError,
  formatGsapMutationRejectionToast,
  readJsonResponseBody,
} from "./gsapScriptCommitHelpers";
import type {
  CommitMutationOptions,
  GsapScriptCommitsParams,
  MutationResult,
} from "./gsapScriptCommitTypes";
import { useGsapAnimationOps } from "./useGsapAnimationOps";
import { useGsapArcPathOps } from "./useGsapArcPathOps";
import { useGsapKeyframeOps } from "./useGsapKeyframeOps";
import { useGsapPropertyDebounce } from "./useGsapPropertyDebounce";
import {
  useGsapSaveFailureTelemetry,
  useSafeGsapCommitMutation,
} from "./useSafeGsapCommitMutation";

async function mutateGsapScript(
  projectId: string,
  sourceFile: string,
  mutation: Record<string, unknown>,
): Promise<MutationResult> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/gsap-mutations/${encodeURIComponent(sourceFile)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mutation),
    },
  );
  if (!res.ok) throw new GsapMutationHttpError(res.status, await readJsonResponseBody(res));
  const result = (await res.json()) as MutationResult;
  if (!result.ok) throw new Error(`Failed to update GSAP in ${sourceFile}`);
  return result;
}

// oxfmt-ignore
// fallow-ignore-next-line complexity
export function useGsapScriptCommits({ projectIdRef, activeCompPath, previewIframeRef, editHistory, domEditSaveTimestampRef, reloadPreview, onCacheInvalidate, onFileContentChanged, showToast, sdkSession }: GsapScriptCommitsParams) {
  // Serializer for per-key commits (options.serializeKey). Keyed by
  // `gsap:${animationId}:meta`, it chains a meta commit onto the prior one for
  // the same animationId so their POSTs can't interleave — which is what made
  // the shadow fidelity diff pair an op with a stale server result and report
  // false ease mismatches. Held in a ref so the chain survives re-renders.
  const serializerRef = useRef(createKeyedSerializer());
  // Pre-existing complexity (server mutate + history + reload branches); this PR
  // adds only a guarded shadow-fidelity dispatch.
  // fallow-ignore-next-line complexity
  const runCommit = useCallback(async (selection: DomEditSelection, mutation: Record<string, unknown>, options: CommitMutationOptions) => {
    const pid = projectIdRef.current;
    if (!pid) return;
    const unsafeFields = findUnsafeMutationValues(mutation);
    if (unsafeFields.length > 0) {
      showToast?.("Couldn't read element layout — try again at a different playhead time", "error");
      if (options.skipReload) return;
      throw new Error(`Mutation contains unsafe values: ${unsafeFields.map((field) => field.path).join(", ")}`);
    }
    const targetPath = selection.sourceFile || activeCompPath || "index.html";
    let result: MutationResult;
    try {
      result = await mutateGsapScript(pid, targetPath, mutation);
    } catch (error) {
      if (error instanceof GsapMutationHttpError) showToast?.(formatGsapMutationRejectionToast(error), "error");
      if (options.skipReload) return;
      throw error;
    }
    if (result.changed === false) return;
    domEditSaveTimestampRef.current = Date.now();
    // Shadow value fidelity: diff the SDK's GSAP writer output against the
    // server's, from the same pre-op file. Fire-and-forget; server authoritative.
    // Meta-level ops carry shadowGsapOp (add / update-meta / delete via
    // useGsapAnimationOps); keyframe ops carry shadowKeyframeOp (add/remove via
    // useGsapKeyframeOps, handled by the gsap_keyframe block below). Per-property
    // handlers (useGsapPropertyDebounce) don't synthesize one yet — deferred follow-up.
    // scriptText is null when the composition has no GSAP script; nothing to diff.
    const fidelityArgs = resolveGsapFidelityArgs(
      sdkSession,
      options.shadowGsapOp,
      result.before,
      result.scriptText,
    );
    if (fidelityArgs) {
      void runShadowGsapFidelity(fidelityArgs.before, fidelityArgs.op, fidelityArgs.serverScript);
    }
    // Keyframe value fidelity (gsap_keyframe): same serialize-diff approach, but
    // the SDK has no keyframe reader so there is no live-existence path — the diff
    // is the only signal. Guarded on a live session + both scripts to diff.
    if (sdkSession && options.shadowKeyframeOp && result.before != null && result.scriptText != null) {
      void runShadowGsapKeyframeFidelity(result.before, options.shadowKeyframeOp, result.scriptText);
    }
    if (result.before != null && result.after != null) {
      await editHistory.recordEdit({ label: options.label, kind: "manual", coalesceKey: options.coalesceKey, files: { [targetPath]: { before: result.before, after: result.after } } });
    }
    if (result.after != null) onFileContentChanged?.(targetPath, result.after);
    if (options.skipReload) return;
    if (result.parsed?.animations) updateKeyframeCacheFromParsed(result.parsed.animations, targetPath, selection.id ?? undefined, mutation);
    options.beforeReload?.();
    if (options.softReload && result.scriptText) {
      if (!applySoftReload(previewIframeRef.current, result.scriptText)) reloadPreview();
    } else {
      reloadPreview();
    }
    onCacheInvalidate();
  }, [projectIdRef, activeCompPath, previewIframeRef, editHistory, domEditSaveTimestampRef, reloadPreview, onCacheInvalidate, onFileContentChanged, showToast, sdkSession]);
  // Every GSAP-script commit is a read-modify-write of one file. Overlapping
  // commits to the SAME file (any op type, any animation) interleave server-side
  // and make the shadow fidelity diff pair an op with a stale server result —
  // the false ease/value mismatches this serializer exists to prevent. So
  // serialize per target file by default; an explicit serializeKey overrides.
  const commitMutation = useCallback(
    (selection: DomEditSelection, mutation: Record<string, unknown>, options: CommitMutationOptions) => {
      const file = selection.sourceFile || activeCompPath || "index.html";
      const key = options.serializeKey ?? `gsap-file:${file}`;
      return serializerRef.current(key, () => runCommit(selection, mutation, options));
    },
    [runCommit, activeCompPath],
  );
  const trackGsapSaveFailure = useGsapSaveFailureTelemetry(activeCompPath);
  const commitMutationSafely = useSafeGsapCommitMutation(commitMutation, trackGsapSaveFailure, showToast);
  const propertyOps = useGsapPropertyDebounce(commitMutationSafely);
  const animationOps = useGsapAnimationOps({ projectIdRef, activeCompPath, commitMutation, commitMutationSafely, showToast, sdkSession });
  const keyframeOps = useGsapKeyframeOps({ activeCompPath, commitMutation, commitMutationSafely, trackGsapSaveFailure });
  const arcPathOps = useGsapArcPathOps(commitMutationSafely);
  return { commitMutation, ...propertyOps, ...animationOps, ...keyframeOps, ...arcPathOps };
}
