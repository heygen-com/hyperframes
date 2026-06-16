import { useCallback } from "react";
import type { Composition, GsapTweenSpec } from "@hyperframes/sdk";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { roundTo3 } from "../utils/rounding";
import { runShadowGsapTween } from "../utils/sdkShadow";
import {
  assignGsapTargetAutoIdIfNeeded,
  ensureElementAddressable,
} from "./gsapScriptCommitHelpers";
import type { CommitMutation, SafeGsapCommitMutation } from "./gsapScriptCommitTypes";

interface GsapAnimationOpsParams {
  projectIdRef: React.MutableRefObject<string | null>;
  activeCompPath: string | null;
  commitMutation: CommitMutation;
  commitMutationSafely: SafeGsapCommitMutation;
  showToast: (message: string, tone?: "error" | "info") => void;
  /** Stage 7 Step 3b: SDK session for shadow GSAP dispatch (server stays authoritative). */
  sdkSession?: Composition | null;
}

export function useGsapAnimationOps({
  projectIdRef,
  activeCompPath,
  commitMutation,
  commitMutationSafely,
  showToast,
  sdkSession,
}: GsapAnimationOpsParams) {
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

  // Pre-existing complexity (auto-id assignment + per-method defaults); this PR
  // adds only a guarded shadow-op construction at the tail.
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

      // Shadow: dispatch the equivalent addGsapTween to the SDK (server stays
      // authoritative). "set" has no SDK method, so it is not shadowed.
      // ponytail: only add is shadowed — delete/update key on the server's
      // animationId, which doesn't resolve in the SDK's independent id-space.
      if (sdkSession && selection.hfId && method !== "set") {
        const tween: GsapTweenSpec = {
          method,
          position,
          duration,
          ease: "power2.out",
          ...(method === "fromTo"
            ? { fromProperties: { opacity: 0 }, toProperties: toDefaults[method] }
            : { properties: toDefaults[method] ?? { opacity: 1 } }),
        };
        runShadowGsapTween(sdkSession, { kind: "add", target: selection.hfId, tween });
      }
    },
    [activeCompPath, commitMutation, projectIdRef, showToast, sdkSession],
  );

  return {
    updateGsapMeta,
    deleteGsapAnimation,
    deleteAllForSelector,
    addGsapAnimation,
  };
}
