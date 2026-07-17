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

export interface FocusedEaseSegment {
  animationId: string;
  collidingAnimationTargets?: AnimationKeyframeTarget[];
  tweenPercentage: number;
  elementId: string;
  projectId: string | null;
  sessionEpoch: number;
  nonce: number;
}

type FocusedEaseSegmentTarget = Omit<FocusedEaseSegment, "projectId" | "sessionEpoch" | "nonce">;

interface TimelineSessionIdentity {
  timelineProjectId: string | null;
  timelineSessionEpoch: number;
}

export function isFocusedEaseRequestCurrent(
  request: FocusedEaseSegment,
  state: TimelineSessionIdentity & { selectedElementId: string | null },
): boolean {
  return (
    request.projectId === state.timelineProjectId &&
    request.sessionEpoch === state.timelineSessionEpoch &&
    request.elementId === state.selectedElementId
  );
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

  /** Project/session/element-scoped request. Its nonce makes stale consumers harmless. */
  focusedEaseSegment: FocusedEaseSegment | null;
  focusedEaseRequestNonce: number;
  setFocusedEaseSegment: (target: FocusedEaseSegmentTarget) => void;
  clearFocusedEaseSegment: (nonce: number) => void;

  /** Keyframe data per element id, populated from parsed GSAP animations. */
  keyframeCache: Map<string, KeyframeCacheEntry>;
  /** Unmerged source tweens per element; expanded property lanes read this, never keyframeCache. */
  gsapAnimations: Map<string, GsapAnimation[]>;
  setGsapAnimations: (elementId: string, animations: GsapAnimation[] | undefined) => void;
  setKeyframeCache: (elementId: string, data: KeyframeCacheEntry | undefined) => void;
}

export function createKeyframeSlice(
  set: StoreApi<KeyframeSlice>["setState"],
  getTimelineSessionIdentity: () => TimelineSessionIdentity,
): KeyframeSlice {
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
    focusedEaseRequestNonce: 0,
    setFocusedEaseSegment: (target) =>
      set((state) => {
        const nonce = state.focusedEaseRequestNonce + 1;
        const { timelineProjectId, timelineSessionEpoch } = getTimelineSessionIdentity();
        return {
          focusedEaseRequestNonce: nonce,
          focusedEaseSegment: {
            ...target,
            projectId: timelineProjectId,
            sessionEpoch: timelineSessionEpoch,
            nonce,
          },
        };
      }),
    clearFocusedEaseSegment: (nonce) =>
      set((state) =>
        state.focusedEaseSegment?.nonce === nonce ? { focusedEaseSegment: null } : state,
      ),

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
