import { useCallback, useEffect, useRef } from "react";
import type { Composition } from "@hyperframes/sdk";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import {
  sdkGsapTweenPersist,
  sdkGsapRemovePropertyPersist,
  type CutoverDeps,
} from "../utils/sdkCutover";
import { PROPERTY_DEFAULTS } from "./gsapScriptCommitHelpers";
import type { SafeGsapCommitMutation } from "./gsapScriptCommitTypes";

const DEBOUNCE_MS = 150;

interface SdkPropertyDeps {
  sdkSession?: Composition | null;
  sdkDeps?: CutoverDeps | null;
  activeCompPath?: string | null;
}

export function useGsapPropertyDebounce(
  commitMutationSafely: SafeGsapCommitMutation,
  sdk?: SdkPropertyDeps,
) {
  const pendingPropertyEditRef = useRef<{
    selection: DomEditSelection;
    animationId: string;
    property: string;
    value: number | string;
  } | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPendingPropertyEdit = useCallback(async () => {
    const pending = pendingPropertyEditRef.current;
    if (!pending) return;
    pendingPropertyEditRef.current = null;
    const { selection, animationId, property, value } = pending;
    const { sdkSession, sdkDeps, activeCompPath } = sdk ?? {};
    if (sdkSession && sdkDeps) {
      const targetPath = selection.sourceFile || activeCompPath || "index.html";
      const handled = await sdkGsapTweenPersist(
        targetPath,
        { kind: "set", animationId, properties: { properties: { [property]: value } } },
        sdkSession,
        sdkDeps,
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
  }, [commitMutationSafely, sdk]);

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
      const { sdkSession, sdkDeps, activeCompPath } = sdk ?? {};
      if (sdkSession && sdkDeps) {
        const targetPath = selection.sourceFile || activeCompPath || "index.html";
        const handled = await sdkGsapTweenPersist(
          targetPath,
          { kind: "set", animationId, properties: { properties: { [property]: defaultValue } } },
          sdkSession,
          sdkDeps,
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
    [commitMutationSafely, sdk],
  );

  const removeProperty = useCallback(
    async (selection: DomEditSelection, animationId: string, property: string, from: boolean) => {
      const { sdkSession, sdkDeps, activeCompPath } = sdk ?? {};
      if (sdkSession && sdkDeps) {
        const targetPath = selection.sourceFile || activeCompPath || "index.html";
        const handled = await sdkGsapRemovePropertyPersist(
          targetPath,
          animationId,
          property,
          from,
          sdkSession,
          sdkDeps,
          { label: `Remove GSAP ${from ? `from-${property}` : property}` },
        );
        if (handled) return;
      }
      if (from) {
        commitMutationSafely(
          selection,
          { type: "remove-from-property", animationId, property },
          {
            label: `Remove GSAP from-${property}`,
          },
        );
      } else {
        commitMutationSafely(
          selection,
          { type: "remove-property", animationId, property },
          {
            label: `Remove GSAP ${property}`,
          },
        );
      }
    },
    [commitMutationSafely, sdk],
  );

  const removeGsapProperty = useCallback(
    (selection: DomEditSelection, animationId: string, property: string) =>
      removeProperty(selection, animationId, property, false),
    [removeProperty],
  );

  const updateGsapFromProperty = useCallback(
    async (
      selection: DomEditSelection,
      animationId: string,
      property: string,
      value: number | string,
    ) => {
      const { sdkSession, sdkDeps, activeCompPath } = sdk ?? {};
      if (sdkSession && sdkDeps) {
        const targetPath = selection.sourceFile || activeCompPath || "index.html";
        const handled = await sdkGsapTweenPersist(
          targetPath,
          { kind: "set", animationId, properties: { fromProperties: { [property]: value } } },
          sdkSession,
          sdkDeps,
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
    [commitMutationSafely, sdk],
  );

  const addGsapFromProperty = useCallback(
    async (selection: DomEditSelection, animationId: string, property: string) => {
      const defaultValue = PROPERTY_DEFAULTS[property] ?? 0;
      const { sdkSession, sdkDeps, activeCompPath } = sdk ?? {};
      if (sdkSession && sdkDeps) {
        const targetPath = selection.sourceFile || activeCompPath || "index.html";
        const handled = await sdkGsapTweenPersist(
          targetPath,
          {
            kind: "set",
            animationId,
            properties: { fromProperties: { [property]: defaultValue } },
          },
          sdkSession,
          sdkDeps,
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
    [commitMutationSafely, sdk],
  );

  const removeGsapFromProperty = useCallback(
    (selection: DomEditSelection, animationId: string, property: string) =>
      removeProperty(selection, animationId, property, true),
    [removeProperty],
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
