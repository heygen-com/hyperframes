/**
 * Unified helper for committing any GSAP property value from the design panel.
 *
 * Handles three cases:
 * 1. Animation with keyframes → add-keyframe at current percentage
 * 2. Flat animation (no keyframes) → convert to keyframes, then add-keyframe
 * 3. No animation → create tl.to(), convert to keyframes, then add-keyframe
 */
import { useCallback } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { usePlayerStore } from "../player/store/playerStore";
import { readAllAnimatedProperties, readGsapProperty } from "./gsapRuntimeBridge";

interface CommitAnimatedPropertyDeps {
  selectedGsapAnimations: GsapAnimation[];
  gsapCommitMutation:
    | ((
        selection: DomEditSelection,
        mutation: Record<string, unknown>,
        options: {
          label: string;
          coalesceKey?: string;
          softReload?: boolean;
          skipReload?: boolean;
        },
      ) => Promise<void>)
    | null;
  addGsapAnimation: (
    selection: DomEditSelection,
    method: "to" | "from" | "set" | "fromTo",
    currentTime?: number,
  ) => void;
  convertToKeyframes: (selection: DomEditSelection, animId: string) => void;
  previewIframeRef: React.RefObject<HTMLIFrameElement | null>;
  bumpGsapCache: () => void;
}

function computePercentage(selection: DomEditSelection): number {
  const elStart = Number.parseFloat(selection.dataAttributes?.start ?? "0") || 0;
  const elDuration = Number.parseFloat(selection.dataAttributes?.duration ?? "1") || 1;
  const currentTime = usePlayerStore.getState().currentTime;
  return elDuration > 0
    ? Math.max(0, Math.min(100, Math.round(((currentTime - elStart) / elDuration) * 1000) / 10))
    : 0;
}

function selectorFor(selection: DomEditSelection): string | null {
  if (selection.id) return `#${selection.id}`;
  if (selection.selector) return selection.selector;
  return null;
}

export function useAnimatedPropertyCommit(deps: CommitAnimatedPropertyDeps) {
  const {
    selectedGsapAnimations,
    gsapCommitMutation,
    addGsapAnimation,
    previewIframeRef,
    bumpGsapCache,
  } = deps;

  const commitAnimatedProperty = useCallback(
    async (
      selection: DomEditSelection,
      property: string,
      value: number | string,
    ): Promise<void> => {
      if (!gsapCommitMutation) return;

      const iframe = previewIframeRef.current;
      const selector = selectorFor(selection);
      const pct = computePercentage(selection);

      let anim: GsapAnimation | undefined =
        selectedGsapAnimations.find((a) => a.keyframes) ?? selectedGsapAnimations[0];

      // Case 3: No animation — create one first
      if (!anim) {
        addGsapAnimation(selection, "to");
        // The addGsapAnimation triggers a reload. We need to wait for the cache
        // to update. Use a small delay then bump cache to re-fetch.
        await new Promise((r) => setTimeout(r, 500));
        bumpGsapCache();
        // After creation, we can't proceed in this call — the animation isn't
        // in our local state yet. The user's next edit will find it.
        // For immediate feedback, trigger a convert-to-keyframes on the new animation.
        return;
      }

      // Case 2: Flat animation — convert to keyframes first
      if (!anim.keyframes) {
        await gsapCommitMutation(
          selection,
          { type: "convert-to-keyframes", animationId: anim.id },
          { label: "Convert to keyframes", skipReload: true },
        );
      }

      // Read all currently animated properties from runtime for backfill
      const runtimeProps = selector ? readAllAnimatedProperties(iframe, selector, anim) : {};

      // Build the properties object: all runtime props + the new value
      const properties: Record<string, number | string> = { ...runtimeProps };
      properties[property] = value;

      // Compute backfill defaults for properties not in existing keyframes
      const backfillDefaults: Record<string, number | string> = { ...runtimeProps };
      if (!(property in runtimeProps) && selector) {
        const cssVal = readGsapProperty(iframe, selector, property);
        if (cssVal != null) backfillDefaults[property] = cssVal;
      }
      backfillDefaults[property] = typeof value === "number" ? value : value;

      await gsapCommitMutation(
        selection,
        {
          type: "add-keyframe",
          animationId: anim.id,
          percentage: pct,
          properties,
          backfillDefaults,
        },
        { label: `Edit ${property} (keyframe ${pct}%)`, softReload: true },
      );
    },
    [selectedGsapAnimations, gsapCommitMutation, addGsapAnimation, previewIframeRef, bumpGsapCache],
  );

  return commitAnimatedProperty;
}
