import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { StoreApi } from "zustand";
import type { AnimationKeyframeTarget } from "../../hooks/gsapTweenSynth";

/** Minimal keyframe cache types — mirrors GsapKeyframesData without pulling in Node-only gsap-parser. */
export interface KeyframeCacheEntry {
  format: string;
  keyframes: Array<{
    percentage: number;
    /** Original tween-relative percentage (server mutations need this, not the clip-relative `percentage`). */
    tweenPercentage?: number;
    /** Which property group the source tween belongs to (position, scale, rotation, visual, etc.). */
    propertyGroup?: string;
    /** Source tween id — lets the inline clip-row ease button target a specific segment. */
    animationId?: string;
    properties: Record<string, number | string>;
    ease?: string;
    /** Source animation/keyframe targets that collide at this clip percentage. */
    collidingAnimationTargets?: AnimationKeyframeTarget[];
  }>;
  ease?: string;
  easeEach?: string;
}

export interface KeyframeSlice {
  /** Selected collapsed (`element:pct`) or expanded (`element:group:animation:clipPct`) diamonds. */
  selectedKeyframes: Set<string>;
  toggleSelectedKeyframe: (key: string) => void;
  clearSelectedKeyframes: () => void;

  /** Clips whose keyframe property lanes are expanded in the timeline. */
  expandedClipIds: Set<string>;
  toggleClipExpanded: (id: string) => void;
  setClipExpanded: (id: string, expanded: boolean) => void;
  /** Union-expand clips (keyframed clips are expanded by default on load). */
  expandClips: (ids: readonly string[]) => void;

  /** elementId scopes the request to one element so a shared (class-selector)
   * animation id can't open the ease editor on the wrong element. */
  focusedEaseSegment: {
    animationId: string;
    collidingAnimationTargets?: AnimationKeyframeTarget[];
    tweenPercentage: number;
    elementId: string;
  } | null;
  setFocusedEaseSegment: (
    target: {
      animationId: string;
      collidingAnimationTargets?: AnimationKeyframeTarget[];
      tweenPercentage: number;
      elementId: string;
    } | null,
  ) => void;

  /** Keyframe data per element id, populated from parsed GSAP animations. */
  keyframeCache: Map<string, KeyframeCacheEntry>;
  /** Unmerged source tweens per element; expanded property lanes read this, never keyframeCache. */
  gsapAnimations: Map<string, GsapAnimation[]>;
  setGsapAnimations: (elementId: string, animations: GsapAnimation[] | undefined) => void;
  setKeyframeCache: (elementId: string, data: KeyframeCacheEntry | undefined) => void;
}

export function createKeyframeSlice(set: StoreApi<KeyframeSlice>["setState"]): KeyframeSlice {
  return {
    selectedKeyframes: new Set(),
    toggleSelectedKeyframe: (key) =>
      set((state) => {
        const next = new Set(state.selectedKeyframes);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return { selectedKeyframes: next };
      }),
    clearSelectedKeyframes: () => set({ selectedKeyframes: new Set() }),

    expandedClipIds: new Set(),
    toggleClipExpanded: (id) =>
      set((state) => {
        const next = new Set(state.expandedClipIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return { expandedClipIds: next };
      }),
    setClipExpanded: (id, expanded) =>
      set((state) => {
        if (state.expandedClipIds.has(id) === expanded) return state;
        const next = new Set(state.expandedClipIds);
        if (expanded) next.add(id);
        else next.delete(id);
        return { expandedClipIds: next };
      }),
    expandClips: (ids) =>
      set((state) => {
        if (ids.every((id) => state.expandedClipIds.has(id))) return state;
        const next = new Set(state.expandedClipIds);
        for (const id of ids) next.add(id);
        return { expandedClipIds: next };
      }),

    focusedEaseSegment: null,
    setFocusedEaseSegment: (target) => set({ focusedEaseSegment: target }),

    keyframeCache: new Map(),
    setKeyframeCache: (elementId, data) =>
      set((state) => {
        const next = new Map(state.keyframeCache);
        if (data) next.set(elementId, data);
        else next.delete(elementId);
        return { keyframeCache: next };
      }),
    gsapAnimations: new Map(),
    setGsapAnimations: (elementId, animations) =>
      set((state) => {
        const next = new Map(state.gsapAnimations);
        if (animations) next.set(elementId, animations);
        else next.delete(elementId);
        return { gsapAnimations: next };
      }),
  };
}
