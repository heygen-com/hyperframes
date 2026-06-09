import { create } from "zustand";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../../utils/studioUiPreferences";

/** Minimal keyframe cache types — mirrors GsapKeyframesData without pulling in Node-only gsap-parser. */
export interface KeyframeCacheEntry {
  format: string;
  keyframes: Array<{
    percentage: number;
    properties: Record<string, number | string>;
    ease?: string;
  }>;
  ease?: string;
  easeEach?: string;
}

export interface TimelineElement {
  id: string;
  label?: string;
  key?: string;
  tag: string;
  start: number;
  duration: number;
  track: number;
  domId?: string;
  /** Stable `data-hf-id` attribute value — used as primary patch target when present */
  hfId?: string;
  /** Best-effort selector used when patching source HTML back from timeline edits */
  selector?: string;
  /** Zero-based occurrence index for non-unique selectors */
  selectorIndex?: number;
  /** Source composition file that owns this element, when known */
  sourceFile?: string;
  src?: string;
  playbackStart?: number;
  playbackStartAttr?: "media-start" | "playback-start";
  playbackRate?: number;
  sourceDuration?: number;
  volume?: number;
  /** Path from data-composition-src — identifies sub-composition elements */
  compositionSrc?: string;
  /** Whether this row came from authored clip timing or Studio's full-duration layer fallback. */
  timingSource?: "authored" | "implicit";
  /** Set by data-timeline-locked on the host element — disables move and trim in Studio. */
  timelineLocked?: boolean;
}

export type ZoomMode = "fit" | "manual";

interface PlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  timelineReady: boolean;
  elements: TimelineElement[];
  selectedElementId: string | null;
  playbackRate: number;
  audioMuted: boolean;
  loopEnabled: boolean;
  /** Timeline zoom: 'fit' auto-scales to viewport, 'manual' uses manualZoomPercent */
  zoomMode: ZoomMode;
  /** Timeline zoom percent relative to the fit width when in manual mode */
  manualZoomPercent: number;
  /** Work-area in-point (seconds). When set, loop starts here and A jumps here. */
  inPoint: number | null;
  /** Work-area out-point (seconds). When set, loop ends here and E jumps here. */
  outPoint: number | null;

  /** Set of selected keyframe keys in format `${elementId}:${percentage}`. */
  selectedKeyframes: Set<string>;
  toggleSelectedKeyframe: (key: string) => void;
  clearSelectedKeyframes: () => void;

  /** Multi-select: additional selected elements beyond selectedElementId. */
  selectedElementIds: Set<string>;
  toggleSelectedElementId: (id: string) => void;
  clearSelectedElementIds: () => void;

  /** Clipboard for keyframe copy/paste — stores keyframes with relative times. */
  keyframeClipboard: Array<{
    relativeTime: number;
    properties: Record<string, number | string>;
    ease?: string;
  }> | null;
  setKeyframeClipboard: (data: PlayerState["keyframeClipboard"]) => void;

  /** Elements with expanded property rows in the timeline. */
  expandedTimelineElements: Set<string>;
  toggleExpandedElement: (id: string) => void;

  /** Keyframe data per element id, populated from parsed GSAP animations. */
  keyframeCache: Map<string, KeyframeCacheEntry>;
  setKeyframeCache: (elementId: string, data: KeyframeCacheEntry | undefined) => void;

  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setPlaybackRate: (rate: number) => void;
  setAudioMuted: (muted: boolean) => void;
  setLoopEnabled: (enabled: boolean) => void;
  setTimelineReady: (ready: boolean) => void;
  setElements: (elements: TimelineElement[]) => void;
  setSelectedElementId: (id: string | null) => void;
  updateElement: (
    elementId: string,
    updates: Partial<Pick<TimelineElement, "start" | "duration" | "track" | "playbackStart">>,
  ) => void;
  setZoomMode: (mode: ZoomMode) => void;
  setManualZoomPercent: (percent: number) => void;
  setInPoint: (time: number | null) => void;
  setOutPoint: (time: number | null) => void;
  reset: () => void;

  /**
   * Request a seek from outside the player loop (e.g. Layers panel).
   * useTimelinePlayer subscribes and calls adapter.seek() + liveTime.notify().
   */
  requestedSeekTime: number | null;
  requestSeek: (time: number) => void;
  clearSeekRequest: () => void;
}

// Lightweight pub-sub for current time during playback.
// Bypasses React state so the RAF loop can update the playhead/time display
// without triggering re-renders on every frame.
type TimeListener = (time: number) => void;
const _timeListeners = new Set<TimeListener>();
export const liveTime = {
  notify: (t: number) => _timeListeners.forEach((cb) => cb(t)),
  subscribe: (cb: TimeListener) => {
    _timeListeners.add(cb);
    return () => _timeListeners.delete(cb);
  },
};

export const usePlayerStore = create<PlayerState>((set) => ({
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  timelineReady: false,
  elements: [],
  selectedElementId: null,
  playbackRate: readStudioUiPreferences().playbackRate ?? 1,
  audioMuted: readStudioUiPreferences().audioMuted ?? false,
  loopEnabled: false,
  zoomMode: "fit",
  manualZoomPercent: 100,
  inPoint: null,
  outPoint: null,

  selectedKeyframes: new Set(),
  toggleSelectedKeyframe: (key) =>
    set((s) => {
      const next = new Set(s.selectedKeyframes);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { selectedKeyframes: next };
    }),
  clearSelectedKeyframes: () => set({ selectedKeyframes: new Set() }),

  keyframeClipboard: null,
  setKeyframeClipboard: (data) => set({ keyframeClipboard: data }),

  selectedElementIds: new Set<string>(),
  toggleSelectedElementId: (id: string) =>
    set((s) => {
      const next = new Set(s.selectedElementIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedElementIds: next };
    }),
  clearSelectedElementIds: () => set({ selectedElementIds: new Set() }),

  expandedTimelineElements: new Set<string>(),
  toggleExpandedElement: (id: string) =>
    set((s) => {
      const next = new Set(s.expandedTimelineElements);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { expandedTimelineElements: next };
    }),

  keyframeCache: new Map(),
  setKeyframeCache: (elementId, data) =>
    set((s) => {
      const next = new Map(s.keyframeCache);
      if (data) next.set(elementId, data);
      else next.delete(elementId);
      return { keyframeCache: next };
    }),

  requestedSeekTime: null,
  requestSeek: (time) => set({ requestedSeekTime: time }),
  clearSeekRequest: () => set({ requestedSeekTime: null }),

  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setPlaybackRate: (rate) => {
    writeStudioUiPreferences({ playbackRate: rate });
    set({ playbackRate: rate });
  },
  setAudioMuted: (muted) => {
    writeStudioUiPreferences({ audioMuted: muted });
    set({ audioMuted: muted });
  },
  setLoopEnabled: (enabled) => set({ loopEnabled: enabled }),
  setZoomMode: (mode) => set({ zoomMode: mode }),
  setInPoint: (time) =>
    set((state) => {
      const t = time !== null && Number.isFinite(time) ? time : null;
      return {
        inPoint: t,
        outPoint:
          t !== null && state.outPoint !== null && t >= state.outPoint ? null : state.outPoint,
        // Setting a work-area marker implies the user wants playback bounded by it.
        // Auto-enable loop so the playhead respects the marker instead of running past.
        loopEnabled: t !== null ? true : state.loopEnabled,
      };
    }),
  setOutPoint: (time) =>
    set((state) => {
      const t = time !== null && Number.isFinite(time) ? time : null;
      return {
        outPoint: t,
        inPoint: t !== null && state.inPoint !== null && t <= state.inPoint ? null : state.inPoint,
        loopEnabled: t !== null ? true : state.loopEnabled,
      };
    }),
  setManualZoomPercent: (percent) =>
    set({ manualZoomPercent: Math.max(10, Math.min(2000, Math.round(percent))) }),
  setCurrentTime: (time) => set({ currentTime: Number.isFinite(time) ? time : 0 }),
  setDuration: (duration) => set({ duration: Number.isFinite(duration) ? duration : 0 }),
  setTimelineReady: (ready) => set({ timelineReady: ready }),
  setElements: (elements) => set({ elements }),
  setSelectedElementId: (id) => set({ selectedElementId: id }),
  updateElement: (elementId, updates) =>
    set((state) => ({
      elements: state.elements.map((el) =>
        (el.key ?? el.id) === elementId ? { ...el, ...updates } : el,
      ),
    })),
  // Resets project-specific state when switching compositions.
  // playbackRate, audioMuted, loopEnabled, zoomMode, and manualZoomPercent are intentionally preserved
  // because they are user preferences that should survive project switches.
  reset: () =>
    set({
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      timelineReady: false,
      elements: [],
      selectedElementId: null,
      inPoint: null,
      outPoint: null,
      selectedKeyframes: new Set(),
      selectedElementIds: new Set(),
      expandedTimelineElements: new Set(),
      keyframeCache: new Map(),
    }),
}));
