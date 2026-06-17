import { useCallback, useMemo, useRef } from "react";
import { findUnsafeMutationValues } from "@hyperframes/core/studio-api/finite-mutation";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { applySoftReload, extractGsapScriptText } from "../utils/gsapSoftReload";
import type { CutoverDeps } from "../utils/sdkCutover";
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
export function useGsapScriptCommits({ projectIdRef, activeCompPath, previewIframeRef, editHistory, domEditSaveTimestampRef, reloadPreview, onCacheInvalidate, onFileContentChanged, showToast, sdkSession, writeProjectFile, forceReloadSdkSession }: GsapScriptCommitsParams) {
  // Serializer for per-key commits (options.serializeKey). Keyed by
  // `gsap:${animationId}:meta`, it chains a meta commit onto the prior one for
  // the same animationId so their POSTs can't interleave. Held in a ref so the
  // chain survives re-renders.
  const serializerRef = useRef(createKeyedSerializer());
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
    if (result.before != null && result.after != null) {
      await editHistory.recordEdit({ label: options.label, kind: "manual", coalesceKey: options.coalesceKey, files: { [targetPath]: { before: result.before, after: result.after } } });
    }
    if (result.after != null) onFileContentChanged?.(targetPath, result.after);
    // Server wrote the file; the in-memory SDK doc is now stale. Resync it so a
    // later SDK-routed edit doesn't serialize the pre-write doc and revert this.
    forceReloadSdkSession?.();
    if (options.skipReload) return;
    if (result.parsed?.animations) updateKeyframeCacheFromParsed(result.parsed.animations, targetPath, selection.id ?? undefined, mutation);
    options.beforeReload?.();
    if (options.softReload && result.scriptText) {
      if (!applySoftReload(previewIframeRef.current, result.scriptText)) reloadPreview();
    } else {
      reloadPreview();
    }
    onCacheInvalidate();
  }, [projectIdRef, activeCompPath, previewIframeRef, editHistory, domEditSaveTimestampRef, reloadPreview, onCacheInvalidate, onFileContentChanged, showToast, forceReloadSdkSession]);
  // Every GSAP-script commit is a read-modify-write of one file. Overlapping
  // commits to the SAME file (any op type, any animation) interleave server-side,
  // so serialize per target file by default; an explicit serializeKey overrides.
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

  // One stable SDK-deps object shared by all GSAP child hooks. Memoized so the
  // hooks' callbacks keep a stable identity (an inline literal here re-fired the
  // property-debounce flush on every render). refresh() soft-reloads (preserving
  // the playhead) and invalidates the panel cache, matching the server path.
  const sdkRefresh = useCallback(
    (after: string) => {
      const script = extractGsapScriptText(after);
      if (!(script && applySoftReload(previewIframeRef.current, script))) reloadPreview();
      onCacheInvalidate();
    },
    [previewIframeRef, reloadPreview, onCacheInvalidate],
  );
  // Reuse the SAME per-file serializer the legacy commitMutation path uses, so
  // SDK gsap-write flushes serialize against legacy commits AND each other —
  // overlapping same-file read-modify-writes can't interleave and lose an edit.
  const serializeByFile = useCallback(
    <T>(key: string, task: () => Promise<T>): Promise<T> => serializerRef.current(key, task),
    [],
  );
  // Read the on-disk bytes of targetPath so the SDK GSAP persist captures the
  // exact prior content as its undo `before` (matching the style/delete paths),
  // instead of a normalized full-DOM re-emit that would reformat the whole file.
  const readProjectFileContent = useCallback(
    async (path: string): Promise<string> => {
      const pid = projectIdRef.current;
      if (!pid) throw new Error("No active project");
      const res = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(path)}`);
      if (!res.ok) throw new Error(`Failed to read ${path}`);
      const data = (await res.json()) as { content?: string };
      if (typeof data.content !== "string") throw new Error(`Missing file contents for ${path}`);
      return data.content;
    },
    [projectIdRef],
  );
  const sdkDeps = useMemo<CutoverDeps | null>(
    () =>
      writeProjectFile
        ? {
            editHistory: { recordEdit: editHistory.recordEdit },
            writeProjectFile,
            reloadPreview,
            domEditSaveTimestampRef,
            refresh: sdkRefresh,
            compositionPath: activeCompPath,
            serialize: serializeByFile,
            readProjectFile: readProjectFileContent,
          }
        : null,
    [
      editHistory.recordEdit,
      writeProjectFile,
      reloadPreview,
      domEditSaveTimestampRef,
      sdkRefresh,
      activeCompPath,
      serializeByFile,
      readProjectFileContent,
    ],
  );

  const propertyOps = useGsapPropertyDebounce(commitMutationSafely, {
    sdkSession,
    sdkDeps,
    activeCompPath,
  });
  const animationOps = useGsapAnimationOps({
    projectIdRef,
    activeCompPath,
    commitMutation,
    commitMutationSafely,
    showToast,
    sdkSession,
    sdkDeps,
  });
  const keyframeOps = useGsapKeyframeOps({
    activeCompPath,
    commitMutation,
    commitMutationSafely,
    trackGsapSaveFailure,
    sdkSession,
    sdkDeps,
  });
  const arcPathOps = useGsapArcPathOps(commitMutationSafely);
  return { commitMutation, ...propertyOps, ...animationOps, ...keyframeOps, ...arcPathOps };
}
