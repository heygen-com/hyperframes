import { useCallback } from "react";
import type { Composition } from "@hyperframes/sdk";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { roundTo3 } from "../utils/rounding";
import { sdkGsapTweenPersist } from "../utils/sdkCutover";
import {
  assignGsapTargetAutoIdIfNeeded,
  ensureElementAddressable,
} from "./gsapScriptCommitHelpers";
import type { CommitMutation, SafeGsapCommitMutation } from "./gsapScriptCommitTypes";
import type { EditHistoryKind } from "../utils/editHistory";

interface SdkAnimationDeps {
  sdkSession?: Composition | null;
  writeProjectFile?: (path: string, content: string) => Promise<void>;
  editHistory?: {
    recordEdit: (entry: {
      label: string;
      kind: EditHistoryKind;
      coalesceKey?: string;
      files: Record<string, { before: string; after: string }>;
    }) => Promise<void>;
  };
  reloadPreview?: () => void;
  domEditSaveTimestampRef?: React.MutableRefObject<number>;
}

interface GsapAnimationOpsParams extends SdkAnimationDeps {
  projectIdRef: React.MutableRefObject<string | null>;
  activeCompPath: string | null;
  commitMutation: CommitMutation;
  commitMutationSafely: SafeGsapCommitMutation;
  showToast: (message: string, tone?: "error" | "info") => void;
}

export function useGsapAnimationOps({
  projectIdRef,
  activeCompPath,
  commitMutation,
  commitMutationSafely,
  showToast,
  sdkSession,
  writeProjectFile,
  editHistory,
  reloadPreview,
  domEditSaveTimestampRef,
}: GsapAnimationOpsParams) {
  const updateGsapMeta = useCallback(
    async (
      selection: DomEditSelection,
      animationId: string,
      updates: { duration?: number; ease?: string; position?: number },
    ) => {
      if (
        sdkSession &&
        writeProjectFile &&
        editHistory &&
        reloadPreview &&
        domEditSaveTimestampRef
      ) {
        const targetPath = selection.sourceFile || activeCompPath || "index.html";
        const handled = await sdkGsapTweenPersist(
          targetPath,
          { kind: "set", animationId, properties: updates },
          sdkSession,
          { editHistory, writeProjectFile, reloadPreview, domEditSaveTimestampRef },
          { label: "Edit GSAP animation", coalesceKey: `gsap:${animationId}:meta` },
        );
        if (handled) return;
      }
      commitMutationSafely(
        selection,
        { type: "update-meta", animationId, updates },
        { label: "Edit GSAP animation", coalesceKey: `gsap:${animationId}:meta` },
      );
    },
    [
      commitMutationSafely,
      activeCompPath,
      sdkSession,
      writeProjectFile,
      editHistory,
      reloadPreview,
      domEditSaveTimestampRef,
    ],
  );

  const deleteGsapAnimation = useCallback(
    async (selection: DomEditSelection, animationId: string) => {
      if (
        sdkSession &&
        writeProjectFile &&
        editHistory &&
        reloadPreview &&
        domEditSaveTimestampRef
      ) {
        const targetPath = selection.sourceFile || activeCompPath || "index.html";
        const handled = await sdkGsapTweenPersist(
          targetPath,
          { kind: "remove", animationId },
          sdkSession,
          { editHistory, writeProjectFile, reloadPreview, domEditSaveTimestampRef },
          { label: "Delete GSAP animation" },
        );
        if (handled) return;
      }
      commitMutationSafely(
        selection,
        { type: "delete", animationId, stripStudioEdits: true },
        { label: "Delete GSAP animation" },
      );
    },
    [
      commitMutationSafely,
      activeCompPath,
      sdkSession,
      writeProjectFile,
      editHistory,
      reloadPreview,
      domEditSaveTimestampRef,
    ],
  );

  const deleteAllForSelector = useCallback(
    (selection: DomEditSelection, targetSelector: string) => {
      // ponytail: no SDK op for delete-all-for-selector; stays server-authoritative
      void commitMutation(
        selection,
        { type: "delete-all-for-selector", targetSelector },
        { label: "Delete all animations for element" },
      );
    },
    [commitMutation],
  );

  // fallow-ignore-next-line complexity
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
      const position = roundTo3(elStart);
      const duration = roundTo3(elDuration);
      const toDefaults: Record<string, Record<string, number>> = {
        from: { opacity: 0 },
        to: { x: 0, y: 0, opacity: 1 },
        set: { opacity: 1 },
        fromTo: { x: 0, y: 0, opacity: 1 },
      };

      // SDK path: addGsapTween only supports from/to/fromTo; "set" stays server-side
      if (
        method !== "set" &&
        selection.hfId &&
        sdkSession &&
        writeProjectFile &&
        editHistory &&
        reloadPreview &&
        domEditSaveTimestampRef
      ) {
        const targetPath = selection.sourceFile || activeCompPath || "index.html";
        const spec = {
          method: method as "to" | "from" | "fromTo",
          position,
          duration,
          ease: "power2.out" as const,
          properties: toDefaults[method] ?? { opacity: 1 },
          fromProperties: method === "fromTo" ? { opacity: 0 } : undefined,
        };
        const handled = await sdkGsapTweenPersist(
          targetPath,
          { kind: "add", target: selection.hfId, spec },
          sdkSession,
          { editHistory, writeProjectFile, reloadPreview, domEditSaveTimestampRef },
          { label: `Add GSAP ${method} animation` },
        );
        if (handled) return;
      }

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
    [
      activeCompPath,
      commitMutation,
      projectIdRef,
      showToast,
      sdkSession,
      writeProjectFile,
      editHistory,
      reloadPreview,
      domEditSaveTimestampRef,
    ],
  );

  return {
    updateGsapMeta,
    deleteGsapAnimation,
    deleteAllForSelector,
    addGsapAnimation,
  };
}
