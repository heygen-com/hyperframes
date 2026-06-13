import { useCallback, useEffect, useRef } from "react";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { PROPERTY_DEFAULTS } from "./gsapScriptCommitHelpers";
import type { SafeGsapCommitMutation } from "./gsapScriptCommitTypes";

const DEBOUNCE_MS = 150;

export function useGsapPropertyDebounce(commitMutationSafely: SafeGsapCommitMutation) {
  const pendingPropertyEditRef = useRef<{
    selection: DomEditSelection;
    animationId: string;
    property: string;
    value: number | string;
  } | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const addGsapProperty = useCallback(
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

  return {
    updateGsapProperty,
    addGsapProperty,
    removeGsapProperty,
    updateGsapFromProperty,
    addGsapFromProperty,
    removeGsapFromProperty,
  };
}
