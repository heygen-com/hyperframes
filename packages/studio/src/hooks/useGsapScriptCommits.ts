import { useCallback, useEffect, useRef } from "react";
import type { GsapAnimation, ParsedGsap } from "@hyperframes/core/gsap-parser";
import { findUnsafeMutationValues } from "@hyperframes/core/studio-api/finite-mutation";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import type { EditHistoryKind } from "../utils/editHistory";
import { applySoftReload } from "../utils/gsapSoftReload";
import { executeOptimistic } from "../utils/optimisticUpdate";
import type { KeyframeCacheEntry } from "../player/store/playerStore";
import { commitKeyframeAtTimeImpl } from "./gsapKeyframeCommit";
import {
  updateKeyframeCacheFromParsed,
  readKeyframeSnapshot,
  writeKeyframeCache,
} from "./gsapKeyframeCacheHelpers";
import {
  useGsapSaveFailureTelemetry,
  useSafeGsapCommitMutation,
} from "./useSafeGsapCommitMutation";
import {
  GsapMutationHttpError,
  assignGsapTargetAutoIdIfNeeded,
  ensureElementAddressable,
  formatGsapMutationRejectionToast,
  PROPERTY_DEFAULTS,
  readJsonResponseBody,
} from "./gsapScriptCommitHelpers";

interface MutationResult {
  ok: boolean;
  changed?: boolean;
  parsed?: ParsedGsap;
  before?: string;
  after?: string;
  scriptText?: string;
}

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
  if (!res.ok) {
    throw new GsapMutationHttpError(res.status, await readJsonResponseBody(res));
  }
  const result = (await res.json()) as MutationResult;
  if (!result.ok) {
    throw new Error(`Failed to update GSAP in ${sourceFile}`);
  }
  return result;
}

function executeOptimisticKeyframeCacheUpdate(options: {
  sourceFile: string;
  elementId: string | null | undefined;
  apply: (entry: KeyframeCacheEntry) => KeyframeCacheEntry;
  persist: () => Promise<void>;
}): Promise<void> {
  return executeOptimistic<KeyframeCacheEntry | undefined>({
    apply: () => {
      const prev = readKeyframeSnapshot(options.sourceFile, options.elementId);
      if (prev) writeKeyframeCache(options.sourceFile, options.elementId, options.apply(prev));
      return prev;
    },
    persist: options.persist,
    rollback: (prev) => {
      writeKeyframeCache(options.sourceFile, options.elementId, prev);
    },
  });
}

interface GsapScriptCommitsParams {
  projectIdRef: React.MutableRefObject<string | null>;
  activeCompPath: string | null;
  previewIframeRef: React.RefObject<HTMLIFrameElement | null>;
  editHistory: {
    recordEdit: (entry: {
      label: string;
      kind: EditHistoryKind;
      coalesceKey?: string;
      files: Record<string, { before: string; after: string }>;
    }) => Promise<void>;
  };
  domEditSaveTimestampRef: React.MutableRefObject<number>;
  reloadPreview: () => void;
  onCacheInvalidate: () => void;
  onFileContentChanged?: (path: string, content: string) => void;
  showToast: (message: string, tone?: "error" | "info") => void;
}
const DEBOUNCE_MS = 150;

// fallow-ignore-next-line complexity
export function useGsapScriptCommits({
  projectIdRef,
  activeCompPath,
  previewIframeRef,
  editHistory,
  domEditSaveTimestampRef,
  reloadPreview,
  onCacheInvalidate,
  onFileContentChanged,
  showToast,
}: GsapScriptCommitsParams) {
  const pendingPropertyEditRef = useRef<{
    selection: DomEditSelection;
    animationId: string;
    property: string;
    value: number | string;
  } | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Send a mutation and record the edit in undo history. */
  const commitMutation = useCallback(
    // fallow-ignore-next-line complexity
    async (
      selection: DomEditSelection,
      mutation: Record<string, unknown>,
      options: {
        label: string;
        coalesceKey?: string;
        softReload?: boolean;
        skipReload?: boolean;
        beforeReload?: () => void;
      },
    ) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const unsafeFields = findUnsafeMutationValues(mutation);
      if (unsafeFields.length > 0) {
        showToast?.(
          "Couldn't read element layout — try again at a different playhead time",
          "error",
        );
        if (options.skipReload) return;
        throw new Error(
          `Mutation contains unsafe values: ${unsafeFields.map((field) => field.path).join(", ")}`,
        );
      }
      const targetPath = selection.sourceFile || activeCompPath || "index.html";
      let result: MutationResult;
      try {
        result = await mutateGsapScript(pid, targetPath, mutation);
      } catch (error) {
        if (error instanceof GsapMutationHttpError) {
          showToast?.(formatGsapMutationRejectionToast(error), "error");
        }
        if (options.skipReload) return;
        throw error;
      }

      if (result.changed === false) {
        if (options.skipReload) return;
        return;
      }

      domEditSaveTimestampRef.current = Date.now();

      if (result.before != null && result.after != null) {
        await editHistory.recordEdit({
          label: options.label,
          kind: "manual",
          coalesceKey: options.coalesceKey,
          files: { [targetPath]: { before: result.before, after: result.after } },
        });
      }

      if (result.after != null) {
        onFileContentChanged?.(targetPath, result.after);
      }

      if (options.skipReload) return;

      // Write the keyframe cache immediately from the parsed response
      // (synchronous — the timeline diamonds appear on the next render).
      if (result.parsed?.animations) {
        updateKeyframeCacheFromParsed(
          result.parsed.animations,
          targetPath,
          selection.id ?? undefined,
          mutation,
        );
      }

      options.beforeReload?.();

      if (options.softReload && result.scriptText) {
        if (!applySoftReload(previewIframeRef.current, result.scriptText)) {
          reloadPreview();
        }
      } else {
        reloadPreview();
      }

      // Bump the cache version AFTER reload so the async re-fetch in
      // useGsapAnimationsForElement reads the post-reload script, not
      // the stale pre-reload version that would overwrite fresh data.
      onCacheInvalidate();
    },
    [
      projectIdRef,
      activeCompPath,
      previewIframeRef,
      editHistory,
      domEditSaveTimestampRef,
      reloadPreview,
      onCacheInvalidate,
      onFileContentChanged,
      showToast,
    ],
  );

  const trackGsapSaveFailure = useGsapSaveFailureTelemetry(activeCompPath);
  const commitMutationSafely = useSafeGsapCommitMutation(
    commitMutation,
    trackGsapSaveFailure,
    showToast,
  );

  const flushPendingPropertyEdit = useCallback(() => {
    const pending = pendingPropertyEditRef.current;
    if (!pending) return;
    pendingPropertyEditRef.current = null;
    const { selection, animationId, property, value } = pending;
    commitMutationSafely(
      selection,
      { type: "update-property", animationId, property, value },
      {
        label: `Edit GSAP ${property}`,
        coalesceKey: `gsap:${animationId}:${property}`,
        softReload: true,
      },
    );
  }, [commitMutationSafely]);

  const updateGsapProperty = useCallback(
    (
      selection: DomEditSelection,
      animationId: string,
      property: string,
      value: number | string,
    ) => {
      pendingPropertyEditRef.current = { selection, animationId, property, value };
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(flushPendingPropertyEdit, DEBOUNCE_MS);
    },
    [flushPendingPropertyEdit],
  );
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      flushPendingPropertyEdit();
    };
  }, [flushPendingPropertyEdit]);

  const updateGsapMeta = useCallback(
    (
      selection: DomEditSelection,
      animationId: string,
      updates: { duration?: number; ease?: string; position?: number },
    ) => {
      commitMutationSafely(
        selection,
        { type: "update-meta", animationId, updates },
        {
          label: "Edit GSAP animation",
          coalesceKey: `gsap:${animationId}:meta`,
        },
      );
    },
    [commitMutationSafely],
  );
  const deleteGsapAnimation = useCallback(
    (selection: DomEditSelection, animationId: string) => {
      commitMutationSafely(
        selection,
        { type: "delete", animationId, stripStudioEdits: true },
        { label: "Delete GSAP animation" },
      );
    },
    [commitMutationSafely],
  );
  const deleteAllForSelector = useCallback(
    (selection: DomEditSelection, targetSelector: string) => {
      void commitMutation(
        selection,
        { type: "delete-all-for-selector", targetSelector },
        { label: "Delete all animations for element" },
      );
    },
    [commitMutation],
  );
  const addGsapAnimation = useCallback(
    // fallow-ignore-next-line complexity
    async (
      selection: DomEditSelection,
      method: "to" | "from" | "set" | "fromTo",
      _currentTime?: number,
    ) => {
      const { selector, autoId } = ensureElementAddressable(selection);

      if (autoId) {
        const pid = projectIdRef.current;
        const targetPath = selection.sourceFile || activeCompPath || "index.html";
        if (!pid) return;
        const assigned = await assignGsapTargetAutoIdIfNeeded({
          projectId: pid,
          targetPath,
          selection,
          autoId,
          showToast,
        });
        if (!assigned) return;
      }

      const elStart = Number.parseFloat(selection.dataAttributes?.start ?? "0") || 0;
      const elDuration = Number.parseFloat(selection.dataAttributes?.duration ?? "1") || 1;
      const position = Math.round(elStart * 1000) / 1000;
      const duration = Math.round(elDuration * 1000) / 1000;
      const toDefaults: Record<string, Record<string, number>> = {
        from: { opacity: 0 },
        to: { x: 0, y: 0, opacity: 1 },
        set: { opacity: 1 },
        fromTo: { x: 0, y: 0, opacity: 1 },
      };

      await commitMutation(
        selection,
        {
          type: "add",
          targetSelector: selector,
          method,
          position,
          duration: method === "set" ? undefined : duration,
          ease: method === "set" ? undefined : "power2.out",
          properties: toDefaults[method] ?? { opacity: 1 },
          fromProperties: method === "fromTo" ? { opacity: 0 } : undefined,
        },
        { label: `Add GSAP ${method} animation` },
      );
    },
    [commitMutation, projectIdRef, activeCompPath, showToast],
  );
  const addGsapProperty = useCallback(
    // fallow-ignore-next-line complexity
    (selection: DomEditSelection, animationId: string, property: string) => {
      let defaultValue = PROPERTY_DEFAULTS[property] ?? 0;
      const el = selection.element;
      if (property === "width" || property === "height") {
        const rect = el.getBoundingClientRect();
        defaultValue = Math.round(property === "width" ? rect.width : rect.height);
      } else if (property === "opacity" || property === "autoAlpha") {
        const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
        defaultValue = cs ? Number.parseFloat(cs.opacity) || 1 : 1;
      }
      commitMutationSafely(
        selection,
        { type: "add-property", animationId, property, defaultValue },
        { label: `Add GSAP ${property}` },
      );
    },
    [commitMutationSafely],
  );
  const removeGsapProperty = useCallback(
    (selection: DomEditSelection, animationId: string, property: string) => {
      commitMutationSafely(
        selection,
        { type: "remove-property", animationId, property },
        { label: `Remove GSAP ${property}` },
      );
    },
    [commitMutationSafely],
  );
  const updateGsapFromProperty = useCallback(
    (
      selection: DomEditSelection,
      animationId: string,
      property: string,
      value: number | string,
    ) => {
      commitMutationSafely(
        selection,
        { type: "update-from-property", animationId, property, value },
        {
          label: `Edit GSAP from-${property}`,
          coalesceKey: `gsap:${animationId}:from:${property}`,
        },
      );
    },
    [commitMutationSafely],
  );
  const addGsapFromProperty = useCallback(
    (selection: DomEditSelection, animationId: string, property: string) => {
      const defaultValue = PROPERTY_DEFAULTS[property] ?? 0;
      commitMutationSafely(
        selection,
        { type: "add-from-property", animationId, property, defaultValue },
        { label: `Add GSAP from-${property}` },
      );
    },
    [commitMutationSafely],
  );
  const removeGsapFromProperty = useCallback(
    (selection: DomEditSelection, animationId: string, property: string) => {
      commitMutationSafely(
        selection,
        { type: "remove-from-property", animationId, property },
        { label: `Remove GSAP from-${property}` },
      );
    },
    [commitMutationSafely],
  );
  const addKeyframe = useCallback(
    (
      selection: DomEditSelection,
      animationId: string,
      percentage: number,
      property: string,
      value: number | string,
    ) => {
      const sf = selection.sourceFile || activeCompPath || "index.html";
      const elementId = selection.id;
      const mutation = {
        type: "add-keyframe",
        animationId,
        percentage,
        properties: { [property]: value },
      };
      void executeOptimisticKeyframeCacheUpdate({
        sourceFile: sf,
        elementId,
        apply: (prev) => ({
          ...prev,
          keyframes: [...prev.keyframes, { percentage, properties: { [property]: value } }].sort(
            (a, b) => a.percentage - b.percentage,
          ),
        }),
        persist: () =>
          commitMutation(selection, mutation, {
            label: `Add keyframe at ${percentage}%`,
            softReload: true,
          }),
      }).catch((error) => {
        trackGsapSaveFailure(error, selection, mutation, `Add keyframe at ${percentage}%`);
      });
    },
    [commitMutation, activeCompPath, trackGsapSaveFailure],
  );
  const addKeyframeBatch = useCallback(
    (
      selection: DomEditSelection,
      animationId: string,
      percentage: number,
      properties: Record<string, number | string>,
    ) => {
      return commitMutation(
        selection,
        { type: "add-keyframe", animationId, percentage, properties },
        { label: `Add keyframe at ${percentage}%`, softReload: true },
      );
    },
    [commitMutation],
  );
  const removeKeyframe = useCallback(
    (selection: DomEditSelection, animationId: string, percentage: number) => {
      const sf = selection.sourceFile || activeCompPath || "index.html";
      const elementId = selection.id;
      const mutation = { type: "remove-keyframe", animationId, percentage };
      void executeOptimisticKeyframeCacheUpdate({
        sourceFile: sf,
        elementId,
        apply: (prev) => ({
          ...prev,
          keyframes: prev.keyframes.filter(
            (kf) => Math.abs((kf.tweenPercentage ?? kf.percentage) - percentage) > 0.2,
          ),
        }),
        persist: () =>
          commitMutation(selection, mutation, {
            label: `Remove keyframe at ${percentage}%`,
            softReload: true,
          }),
      }).catch((error) => {
        trackGsapSaveFailure(error, selection, mutation, `Remove keyframe at ${percentage}%`);
      });
    },
    [commitMutation, activeCompPath, trackGsapSaveFailure],
  );
  const convertToKeyframes = useCallback(
    (
      selection: DomEditSelection,
      animationId: string,
      resolvedFromValues?: Record<string, number | string>,
    ) => {
      return commitMutation(
        selection,
        { type: "convert-to-keyframes", animationId, resolvedFromValues },
        { label: "Convert to keyframes" },
      );
    },
    [commitMutation],
  );
  const removeAllKeyframes = useCallback(
    (selection: DomEditSelection, animationId: string) => {
      commitMutationSafely(
        selection,
        { type: "remove-all-keyframes", animationId },
        { label: "Remove all keyframes", softReload: true },
      );
    },
    [commitMutationSafely],
  );
  const setArcPath = useCallback(
    (
      selection: DomEditSelection,
      animationId: string,
      config: {
        enabled: boolean;
        autoRotate?: boolean | number;
        segments?: Array<{
          curviness: number;
          cp1?: { x: number; y: number };
          cp2?: { x: number; y: number };
        }>;
      },
    ) => {
      commitMutationSafely(
        selection,
        { type: "set-arc-path" as const, animationId, ...config },
        { label: config.enabled ? "Enable arc path" : "Disable arc path", softReload: true },
      );
    },
    [commitMutationSafely],
  );
  const updateArcSegment = useCallback(
    (
      selection: DomEditSelection,
      animationId: string,
      segmentIndex: number,
      update: {
        curviness?: number;
        cp1?: { x: number; y: number };
        cp2?: { x: number; y: number };
      },
    ) => {
      commitMutationSafely(
        selection,
        { type: "update-arc-segment" as const, animationId, segmentIndex, ...update },
        { label: "Update arc segment", softReload: true },
      );
    },
    [commitMutationSafely],
  );
  const removeArcPath = useCallback(
    (selection: DomEditSelection, animationId: string) => {
      commitMutationSafely(
        selection,
        { type: "remove-arc-path" as const, animationId },
        { label: "Remove arc path", softReload: true },
      );
    },
    [commitMutationSafely],
  );
  const commitKeyframeAtTime = useCallback(
    (
      selection: DomEditSelection,
      absoluteTime: number,
      animations: GsapAnimation[],
      properties: Record<string, number | string>,
    ) => commitKeyframeAtTimeImpl(selection, absoluteTime, animations, properties, commitMutation),
    [commitMutation],
  );
  return {
    commitMutation,
    updateGsapProperty,
    updateGsapMeta,
    deleteGsapAnimation,
    deleteAllForSelector,
    addGsapAnimation,
    addGsapProperty,
    removeGsapProperty,
    updateGsapFromProperty,
    addGsapFromProperty,
    removeGsapFromProperty,
    addKeyframe,
    addKeyframeBatch,
    removeKeyframe,
    convertToKeyframes,
    removeAllKeyframes,
    setArcPath,
    updateArcSegment,
    removeArcPath,
    commitKeyframeAtTime,
  };
}
