import { useCallback, useEffect, useRef } from "react";
import type { Composition } from "@hyperframes/sdk";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { sdkGsapTweenPersist } from "../utils/sdkCutover";
import { PROPERTY_DEFAULTS } from "./gsapScriptCommitHelpers";
import type { SafeGsapCommitMutation } from "./gsapScriptCommitTypes";
import type { EditHistoryKind } from "../utils/editHistory";

const DEBOUNCE_MS = 150;

interface SdkPropertyDeps {
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
  activeCompPath?: string | null;
}

export function useGsapPropertyDebounce(
  commitMutationSafely: SafeGsapCommitMutation,
  sdkDeps?: SdkPropertyDeps,
) {
  const pendingPropertyEditRef = useRef<{
    selection: DomEditSelection;
    animationId: string;
    property: string;
    value: number | string;
  } | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // fallow-ignore-next-line complexity
  const flushPendingPropertyEdit = useCallback(
    // fallow-ignore-next-line complexity
    async () => {
      const pending = pendingPropertyEditRef.current;
      if (!pending) return;
      pendingPropertyEditRef.current = null;
      const { selection, animationId, property, value } = pending;
      const {
        sdkSession,
        writeProjectFile,
        editHistory,
        reloadPreview,
        domEditSaveTimestampRef,
        activeCompPath,
      } = sdkDeps ?? {};
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
          { kind: "set", animationId, properties: { properties: { [property]: value } } },
          sdkSession,
          { editHistory, writeProjectFile, reloadPreview, domEditSaveTimestampRef },
          { label: `Edit GSAP ${property}`, coalesceKey: `gsap:${animationId}:${property}` },
        );
        if (handled) return;
      }
      commitMutationSafely(
        selection,
        { type: "update-property", animationId, property, value },
        {
          label: `Edit GSAP ${property}`,
          coalesceKey: `gsap:${animationId}:${property}`,
          softReload: true,
        },
      );
    },
    [commitMutationSafely, sdkDeps],
  );

  const updateGsapProperty = useCallback(
    (
      selection: DomEditSelection,
      animationId: string,
      property: string,
      value: number | string,
    ) => {
      pendingPropertyEditRef.current = { selection, animationId, property, value };
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        void flushPendingPropertyEdit();
      }, DEBOUNCE_MS);
    },
    [flushPendingPropertyEdit],
  );

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      void flushPendingPropertyEdit();
    };
  }, [flushPendingPropertyEdit]);

  // fallow-ignore-next-line complexity
  const addGsapProperty = useCallback(
    // fallow-ignore-next-line complexity
    async (selection: DomEditSelection, animationId: string, property: string) => {
      let defaultValue = PROPERTY_DEFAULTS[property] ?? 0;
      const el = selection.element;
      if (property === "width" || property === "height") {
        const rect = el.getBoundingClientRect();
        defaultValue = Math.round(property === "width" ? rect.width : rect.height);
      } else if (property === "opacity" || property === "autoAlpha") {
        const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
        defaultValue = cs ? Number.parseFloat(cs.opacity) || 1 : 1;
      }
      const {
        sdkSession,
        writeProjectFile,
        editHistory,
        reloadPreview,
        domEditSaveTimestampRef,
        activeCompPath,
      } = sdkDeps ?? {};
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
          { kind: "set", animationId, properties: { properties: { [property]: defaultValue } } },
          sdkSession,
          { editHistory, writeProjectFile, reloadPreview, domEditSaveTimestampRef },
          { label: `Add GSAP ${property}` },
        );
        if (handled) return;
      }
      commitMutationSafely(
        selection,
        { type: "add-property", animationId, property, defaultValue },
        { label: `Add GSAP ${property}` },
      );
    },
    [commitMutationSafely, sdkDeps],
  );

  const removeGsapProperty = useCallback(
    (selection: DomEditSelection, animationId: string, property: string) => {
      // ponytail: null ≠ removal in upsertProp; remove-property stays server-authoritative
      commitMutationSafely(
        selection,
        { type: "remove-property", animationId, property },
        { label: `Remove GSAP ${property}` },
      );
    },
    [commitMutationSafely],
  );

  // fallow-ignore-next-line complexity
  const updateGsapFromProperty = useCallback(
    // fallow-ignore-next-line complexity
    async (
      selection: DomEditSelection,
      animationId: string,
      property: string,
      value: number | string,
    ) => {
      const {
        sdkSession,
        writeProjectFile,
        editHistory,
        reloadPreview,
        domEditSaveTimestampRef,
        activeCompPath,
      } = sdkDeps ?? {};
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
          { kind: "set", animationId, properties: { fromProperties: { [property]: value } } },
          sdkSession,
          { editHistory, writeProjectFile, reloadPreview, domEditSaveTimestampRef },
          {
            label: `Edit GSAP from-${property}`,
            coalesceKey: `gsap:${animationId}:from:${property}`,
          },
        );
        if (handled) return;
      }
      commitMutationSafely(
        selection,
        { type: "update-from-property", animationId, property, value },
        {
          label: `Edit GSAP from-${property}`,
          coalesceKey: `gsap:${animationId}:from:${property}`,
        },
      );
    },
    [commitMutationSafely, sdkDeps],
  );

  // fallow-ignore-next-line complexity
  const addGsapFromProperty = useCallback(
    // fallow-ignore-next-line complexity
    async (selection: DomEditSelection, animationId: string, property: string) => {
      const defaultValue = PROPERTY_DEFAULTS[property] ?? 0;
      const {
        sdkSession,
        writeProjectFile,
        editHistory,
        reloadPreview,
        domEditSaveTimestampRef,
        activeCompPath,
      } = sdkDeps ?? {};
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
          {
            kind: "set",
            animationId,
            properties: { fromProperties: { [property]: defaultValue } },
          },
          sdkSession,
          { editHistory, writeProjectFile, reloadPreview, domEditSaveTimestampRef },
          { label: `Add GSAP from-${property}` },
        );
        if (handled) return;
      }
      commitMutationSafely(
        selection,
        { type: "add-from-property", animationId, property, defaultValue },
        { label: `Add GSAP from-${property}` },
      );
    },
    [commitMutationSafely, sdkDeps],
  );

  const removeGsapFromProperty = useCallback(
    (selection: DomEditSelection, animationId: string, property: string) => {
      // ponytail: null ≠ removal in upsertProp; remove-from-property stays server-authoritative
      commitMutationSafely(
        selection,
        { type: "remove-from-property", animationId, property },
        { label: `Remove GSAP from-${property}` },
      );
    },
    [commitMutationSafely],
  );

  return {
    updateGsapProperty,
    addGsapProperty,
    removeGsapProperty,
    updateGsapFromProperty,
    addGsapFromProperty,
    removeGsapFromProperty,
  };
}
