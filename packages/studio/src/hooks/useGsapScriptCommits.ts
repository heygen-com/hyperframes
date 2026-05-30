import { useCallback, useEffect, useRef } from "react";
import type { ParsedGsap } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import type { EditHistoryKind } from "../utils/editHistory";
import { applySoftReload } from "../utils/gsapSoftReload";

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
      options: { label: string; coalesceKey?: string; softReload?: boolean },
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

      onCacheInvalidate();

      if (options.softReload && result.scriptText) {
        if (!applySoftReload(previewIframeRef.current, result.scriptText)) {
          reloadPreview();
        }
      } else {
        reloadPreview();
      }
    },
    [
      projectIdRef,
      activeCompPath,
      previewIframeRef,
      editHistory,
      domEditSaveTimestampRef,
      reloadPreview,
      onCacheInvalidate,
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
      currentTime?: number,
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

      const start = currentTime ?? (Number.parseFloat(selection.dataAttributes.start ?? "0") || 0);
      const toDefaults: Record<string, Record<string, number>> = {
        from: { opacity: 0 },
        to: { opacity: 1 },
        set: { opacity: 1 },
        fromTo: { opacity: 1 },
      };

      await commitMutation(
        selection,
        {
          type: "add",
          targetSelector: selector,
          method,
          position: start,
          duration: method === "set" ? undefined : 0.5,
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

  return {
    updateGsapProperty,
    updateGsapMeta,
    deleteGsapAnimation,
    addGsapAnimation,
    addGsapProperty,
    removeGsapProperty,
    updateGsapFromProperty,
    addGsapFromProperty,
    removeGsapFromProperty,
  };
}
