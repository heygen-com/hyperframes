import { useCallback, useEffect, useRef } from "react";
import type { GsapAnimation, ParsedGsap } from "@hyperframes/core/gsap-parser";
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

const PROPERTY_DEFAULTS: Record<string, number> = {
  opacity: 1,
  x: 0,
  y: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  width: 100,
  height: 100,
};

/**
 * Ensures the element has an id so it can be targeted by a GSAP selector.
 * If the element already has an id or a CSS selector, returns those.
 * Otherwise mints a unique id and sets it on the live element.
 */
function ensureElementAddressable(selection: DomEditSelection): {
  selector: string;
  autoId?: string;
} {
  if (selection.id) return { selector: `#${selection.id}` };
  if (selection.selector) return { selector: selection.selector };

  const el = selection.element;
  const doc = el.ownerDocument;
  const tag = el.tagName.toLowerCase();
  let id = tag;
  let n = 1;
  while (doc.getElementById(id)) {
    n += 1;
    id = `${tag}-${n}`;
  }
  el.setAttribute("id", id);
  return { selector: `#${id}`, autoId: id };
}

interface MutationResult {
  ok: boolean;
  parsed?: ParsedGsap;
  before?: string;
  after?: string;
  scriptText?: string;
}

async function mutateGsapScript(
  projectId: string,
  sourceFile: string,
  mutation: Record<string, unknown>,
): Promise<MutationResult | null> {
  try {
    const res = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/gsap-mutations/${encodeURIComponent(sourceFile)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mutation),
      },
    );
    if (!res.ok) return null;
    return (await res.json()) as MutationResult;
  } catch {
    return null;
  }
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
}
const DEBOUNCE_MS = 150;

// fallow-ignore-next-line complexity unit-size
export function useGsapScriptCommits({
  projectIdRef,
  activeCompPath,
  previewIframeRef,
  editHistory,
  domEditSaveTimestampRef,
  reloadPreview,
  onCacheInvalidate,
  onFileContentChanged,
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
      const targetPath = selection.sourceFile || activeCompPath || "index.html";

      const result = await mutateGsapScript(pid, targetPath, mutation);
      if (!result?.ok) return;

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
    ],
  );
  const flushPendingPropertyEdit = useCallback(() => {
    const pending = pendingPropertyEditRef.current;
    if (!pending) return;
    pendingPropertyEditRef.current = null;
    const { selection, animationId, property, value } = pending;
    void commitMutation(
      selection,
      { type: "update-property", animationId, property, value },
      {
        label: `Edit GSAP ${property}`,
        coalesceKey: `gsap:${animationId}:${property}`,
        softReload: true,
      },
    );
  }, [commitMutation]);

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
      void commitMutation(
        selection,
        { type: "update-meta", animationId, updates },
        {
          label: "Edit GSAP animation",
          coalesceKey: `gsap:${animationId}:meta`,
        },
      );
    },
    [commitMutation],
  );
  const deleteGsapAnimation = useCallback(
    (selection: DomEditSelection, animationId: string) => {
      void commitMutation(
        selection,
        { type: "delete", animationId },
        { label: "Delete GSAP animation" },
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
        const res = await fetch(
          `/api/projects/${encodeURIComponent(pid)}/file-mutations/patch-element/${encodeURIComponent(targetPath)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              target: {
                id: selection.id,
                hfId: selection.hfId,
                selector: selection.selector,
                selectorIndex: selection.selectorIndex,
              },
              operations: [{ type: "html-attribute", property: "id", value: autoId }],
            }),
          },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { changed?: boolean };
        if (!data.changed) return;
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
    [commitMutation, projectIdRef, activeCompPath],
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
      void commitMutation(
        selection,
        { type: "add-property", animationId, property, defaultValue },
        { label: `Add GSAP ${property}` },
      );
    },
    [commitMutation],
  );
  const removeGsapProperty = useCallback(
    (selection: DomEditSelection, animationId: string, property: string) => {
      void commitMutation(
        selection,
        { type: "remove-property", animationId, property },
        { label: `Remove GSAP ${property}` },
      );
    },
    [commitMutation],
  );
  const updateGsapFromProperty = useCallback(
    (
      selection: DomEditSelection,
      animationId: string,
      property: string,
      value: number | string,
    ) => {
      void commitMutation(
        selection,
        { type: "update-from-property", animationId, property, value },
        {
          label: `Edit GSAP from-${property}`,
          coalesceKey: `gsap:${animationId}:from:${property}`,
        },
      );
    },
    [commitMutation],
  );
  const addGsapFromProperty = useCallback(
    (selection: DomEditSelection, animationId: string, property: string) => {
      const defaultValue = PROPERTY_DEFAULTS[property] ?? 0;
      void commitMutation(
        selection,
        { type: "add-from-property", animationId, property, defaultValue },
        { label: `Add GSAP from-${property}` },
      );
    },
    [commitMutation],
  );
  const removeGsapFromProperty = useCallback(
    (selection: DomEditSelection, animationId: string, property: string) => {
      void commitMutation(
        selection,
        { type: "remove-from-property", animationId, property },
        { label: `Remove GSAP from-${property}` },
      );
    },
    [commitMutation],
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
      void executeOptimistic<KeyframeCacheEntry | undefined>({
        apply: () => {
          const prev = readKeyframeSnapshot(sf, elementId);
          if (prev) {
            const newKeyframes = [
              ...prev.keyframes,
              { percentage, properties: { [property]: value } },
            ].sort((a, b) => a.percentage - b.percentage);
            writeKeyframeCache(sf, elementId, { ...prev, keyframes: newKeyframes });
          }
          return prev;
        },
        persist: () =>
          commitMutation(
            selection,
            { type: "add-keyframe", animationId, percentage, properties: { [property]: value } },
            { label: `Add keyframe at ${percentage}%`, softReload: true },
          ),
        rollback: (prev) => {
          writeKeyframeCache(sf, elementId, prev);
        },
      });
    },
    [commitMutation, activeCompPath],
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
      void executeOptimistic<KeyframeCacheEntry | undefined>({
        apply: () => {
          const prev = readKeyframeSnapshot(sf, elementId);
          if (prev) {
            const newKeyframes = prev.keyframes.filter((kf) => kf.percentage !== percentage);
            writeKeyframeCache(sf, elementId, { ...prev, keyframes: newKeyframes });
          }
          return prev;
        },
        persist: () =>
          commitMutation(
            selection,
            { type: "remove-keyframe", animationId, percentage },
            { label: `Remove keyframe at ${percentage}%`, softReload: true },
          ),
        rollback: (prev) => {
          writeKeyframeCache(sf, elementId, prev);
        },
      });
    },
    [commitMutation, activeCompPath],
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
      void commitMutation(
        selection,
        { type: "remove-all-keyframes", animationId },
        { label: "Remove all keyframes", softReload: true },
      );
    },
    [commitMutation],
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
      void commitMutation(
        selection,
        { type: "set-arc-path" as const, animationId, ...config },
        { label: config.enabled ? "Enable arc path" : "Disable arc path", softReload: true },
      );
    },
    [commitMutation],
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
      void commitMutation(
        selection,
        { type: "update-arc-segment" as const, animationId, segmentIndex, ...update },
        { label: "Update arc segment", softReload: true },
      );
    },
    [commitMutation],
  );
  const removeArcPath = useCallback(
    (selection: DomEditSelection, animationId: string) => {
      void commitMutation(
        selection,
        { type: "remove-arc-path" as const, animationId },
        { label: "Remove arc path", softReload: true },
      );
    },
    [commitMutation],
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
