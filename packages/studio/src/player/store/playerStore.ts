import { create } from "zustand";
import type { MusicBeatAnalysis } from "@hyperframes/core/beats";
import type { BeatEditState } from "../../utils/beatEditing";
import type { ClipManifestClip } from "../lib/playbackTypes";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../../utils/studioUiPreferences";
import { computePinnedZoomPercent } from "../components/timelineZoom";

/** Minimal keyframe cache types — mirrors GsapKeyframesData without pulling in Node-only gsap-parser. */
export interface KeyframeCacheEntry {
  format: string;
  keyframes: Array<{
    percentage: number;
    /** Original tween-relative percentage (server mutations need this, not the clip-relative `percentage`). */
    tweenPercentage?: number;
    /** Which property group the source tween belongs to (position, scale, rotation, visual, etc.). */
    propertyGroup?: string;
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
  /**
   * The data-track-index as written in the source file. Set at the manifest
   * translation boundary (createTimelineElementFromManifestClip) from the
   * runtime clip's verbatim track, and preserved through display-lane remaps
   * (normalizeToZones packs sparse authored tracks onto contiguous display
   * lanes; expanded sub-comp children get synthetic display rows). Lane edits
   * must persist THIS space — writing a display-lane number into a sparse file
   * re-targets the wrong track. For an expanded child the value is in its OWN
   * source file's coordinate space, not the host timeline's.
   */
  authoredTrack?: number;
  /** Resolved z-index for stacking-aware timeline ordering. */
  zIndex?: number;
  /** True when the effective z-index was authored inline or through CSS, not auto. */
  hasExplicitZIndex?: boolean;
  /** Stacking context this element belongs to; root clips use the root composition id. */
  stackingContextId?: string | null;
  /** Nearest parent composition context, matching RuntimeTimelineClip. */
  parentCompositionId?: string | null;
  /** Composition ancestry from root to nearest parent, matching RuntimeTimelineClip. */
  compositionAncestors?: string[];
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
  /** Set by data-hidden on the host element — hides the clip in preview and render. */
  hidden?: boolean;
  /** Value of data-timeline-role attribute — used to identify music vs. voiceover. */
  timelineRole?: string;
  /**
   * Set by useExpandedTimelineElements on an inline-expanded sub-composition
   * child: the absolute master-timeline start of the sub-comp host the child
   * lives in. Presence marks the element as expanded; edits subtract it to get
   * the child's local (sourceFile-relative) time. Works at any nesting depth.
   */
  expandedParentStart?: number;
}

export type ZoomMode = "fit" | "manual";
type TimelineTool = "select" | "razor";

export interface SelectElementOptions {
  preserveSet?: boolean;
}

function resolveElementSelection(
  ids: Iterable<string>,
  anchor?: string | null,
): { selectedElementIds: Set<string>; selectedElementId: string | null } {
  const selectedElementIds = new Set(ids);
  if (selectedElementIds.size === 0) {
    return { selectedElementIds, selectedElementId: null };
  }
  if (anchor && selectedElementIds.has(anchor)) {
    return { selectedElementIds, selectedElementId: anchor };
  }
  return {
    selectedElementIds,
    selectedElementId: selectedElementIds.values().next().value ?? null,
  };
}

interface PlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  timelineReady: boolean;
  /** True while a beat dot is being dragged — hides the playhead guideline. */
  beatDragging: boolean;
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

  activeTool: TimelineTool;
  setActiveTool: (tool: TimelineTool) => void;

  /** Set of selected keyframe keys in format `${elementId}:${percentage}`. */
  selectedKeyframes: Set<string>;
  toggleSelectedKeyframe: (key: string) => void;
  clearSelectedKeyframes: () => void;

  /** Tween-relative percentage of the last-clicked keyframe diamond. Operations
   *  (drag, resize, rotate) target this instead of recomputing from playhead. */
  activeKeyframePct: number | null;
  setActiveKeyframePct: (pct: number | null) => void;
  /** Motion-path "set destination" mode. Armed from the preview toolbar (replaces
   *  the old double-click-on-canvas UX); while armed, one canvas click places the
   *  new path's destination. `available` is published by MotionPathOverlay so the
   *  toolbar shows the button only when the selected element can take a path. */
  motionPathArmed: boolean;
  setMotionPathArmed: (armed: boolean) => void;
  motionPathCreateAvailable: boolean;
  setMotionPathCreateAvailable: (available: boolean) => void;
  /** Global toggle for the "Add keyframe" diamond in the timeline toolbar (#1808).
   *  When false, a manual drag/resize/rotate edit on an element that already has
   *  a live tween shifts every keyframe by the edit's delta (preserving the
   *  animation's shape) instead of inserting/updating a keyframe at the playhead. */
  autoKeyframeEnabled: boolean;
  setAutoKeyframeEnabled: (enabled: boolean) => void;

  /** Multi-select: additional selected elements beyond selectedElementId. */
  selectedElementIds: Set<string>;
  clearSelectedElementIds: () => void;
  /** Replace the whole multi-selection at once (marquee live updates). */
  setSelectedElementIds: (ids: Set<string>) => void;
  /** Timeline magnet toggle — when false, clip drags/trims/drops never snap. */
  timelineSnapEnabled: boolean;
  setTimelineSnapEnabled: (enabled: boolean) => void;
  /** Transport + ruler readout: timecode ("time") or frame number ("frame"). */
  timeDisplayMode: "time" | "frame";
  setTimeDisplayMode: (mode: "time" | "frame") => void;
  /**
   * Pin the timeline zoom to its current visual scale before a duration-changing
   * edit, so a subsequent duration change (which recomputes fit-pps) stops
   * rescaling every clip. No-op once already pinned (mode is "manual").
   */
  pinTimelineZoom: (currentPixelsPerSecond: number, fitPixelsPerSecond: number) => void;
  /**
   * The timeline's live pixels-per-second + fit basis, published by <Timeline> on
   * every render. Non-reactive scratch state (never read as a render input).
   */
  timelinePps: number;
  timelineFitPps: number;
  setTimelineScale: (pps: number, fitPps: number) => void;
  setSelection: (ids: Iterable<string>, anchor?: string | null) => void;
  addSelectedElementId: (id: string) => void;
  toggleSelectedElementId: (id: string) => void;
  clearSelection: () => void;

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
  setBeatDragging: (dragging: boolean) => void;
  setElements: (elements: TimelineElement[]) => void;
  setSelectedElementId: (id: string | null, options?: SelectElementOptions) => void;
  /** Move the selection anchor within an active multi-selection without collapsing it. */
  setSelectionAnchor: (id: string | null) => void;
  updateElement: (
    elementId: string,
    updates: Partial<
      Pick<
        TimelineElement,
        "start" | "duration" | "track" | "zIndex" | "hasExplicitZIndex" | "playbackStart" | "hidden"
      >
    >,
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

  /**
   * Request the timeline to scroll a clip into view (e.g. clicking an
   * already-added asset card in the sidebar). Consumed and cleared by
   * useTimelineRevealClip. The nonce makes repeat requests for the same
   * clip observable so a second click re-reveals after the user scrolls away.
   */
  clipRevealRequest: { elementId: string; nonce: number } | null;
  requestClipReveal: (elementId: string) => void;
  clearClipRevealRequest: () => void;

  lintFindingsByElement: Map<string, { count: number; messages: string[] }>;
  setLintFindingsByElement: (map: Map<string, { count: number; messages: string[] }>) => void;

  beatAnalysis: MusicBeatAnalysis | null;
  setBeatAnalysis: (analysis: MusicBeatAnalysis | null) => void;

  /** User edits (add/move/delete) layered over the detected beat grid. */
  beatEdits: BeatEditState | null;
  setBeatEdits: (edits: BeatEditState | null) => void;
  /** Undo/redo stacks for beat edits (in-memory, session-only). */
  beatUndo: BeatHistoryEntry[];
  beatRedo: BeatHistoryEntry[];
  commitBeatEdits: (next: BeatEditState | null, label: string) => void;
  undoBeatEdits: () => string | null;
  redoBeatEdits: () => string | null;
  resetBeatHistory: () => void;
  beatPersist: (() => void) | null;
  setBeatPersist: (fn: (() => void) | null) => void;

  clipManifest: ClipManifestClip[] | null;
  setClipManifest: (clips: ClipManifestClip[] | null) => void;
  clipParentMap: Map<string, string>;
  setClipParentMap: (map: Map<string, string>) => void;
  /**
   * Sub-composition DOM descendants (groups + their children) that have no
   * `data-start`, so they're absent from the clip manifest/tree. Collected
   * studio-side from the live preview so the timeline can expand a sub-comp row
   * to show its DOM-only children. Keeps the manifest lean (timed clips only).
   */
  domClipChildren: DomClipChild[];
  setDomClipChildren: (children: DomClipChild[]) => void;
}

/** A sub-comp DOM-only timeline child (no data-start) and its nesting context. */
export interface DomClipChild {
  id: string;
  parentId: string;
  /** The manifest sub-comp host clip id this descendant ultimately lives under. */
  hostId: string;
  label: string;
}

interface BeatHistoryEntry {
  restore: BeatEditState | null;
  at: number;
  label: string;
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

export const usePlayerStore = create<PlayerState>((set, get) => ({
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  timelineReady: false,
  beatDragging: false,
  elements: [],
  selectedElementId: null,
  playbackRate: readStudioUiPreferences().playbackRate ?? 1,
  audioMuted: readStudioUiPreferences().audioMuted ?? false,
  loopEnabled: false,
  zoomMode: "fit",
  manualZoomPercent: 100,
  timelinePps: 100,
  timelineFitPps: 100,
  inPoint: null,
  outPoint: null,

  activeTool: "select",
  setActiveTool: (tool) => set({ activeTool: tool }),

  selectedKeyframes: new Set(),
  toggleSelectedKeyframe: (key) =>
    set((s) => {
      const next = new Set(s.selectedKeyframes);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { selectedKeyframes: next };
    }),
  clearSelectedKeyframes: () => set({ selectedKeyframes: new Set() }),

  activeKeyframePct: null,
  setActiveKeyframePct: (pct) => set({ activeKeyframePct: pct }),
  motionPathArmed: false,
  setMotionPathArmed: (armed) => set({ motionPathArmed: armed }),
  motionPathCreateAvailable: false,
  setMotionPathCreateAvailable: (available) => set({ motionPathCreateAvailable: available }),
  autoKeyframeEnabled: true,
  setAutoKeyframeEnabled: (enabled) => set({ autoKeyframeEnabled: enabled }),

  selectedElementIds: new Set<string>(),
  setSelection: (ids, anchor) => set(resolveElementSelection(ids, anchor)),
  addSelectedElementId: (id: string) =>
    set((s) => {
      const next = new Set(s.selectedElementIds);
      next.add(id);
      return resolveElementSelection(next, s.selectedElementId);
    }),
  toggleSelectedElementId: (id: string) =>
    set((s) => {
      const next = new Set(s.selectedElementIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return resolveElementSelection(next, s.selectedElementId);
    }),
  clearSelection: () => set({ selectedElementId: null, selectedElementIds: new Set() }),

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

  clipRevealRequest: null,
  requestClipReveal: (elementId) =>
    set((s) => ({
      clipRevealRequest: { elementId, nonce: (s.clipRevealRequest?.nonce ?? 0) + 1 },
    })),
  clearClipRevealRequest: () => set({ clipRevealRequest: null }),

  lintFindingsByElement: new Map(),
  setLintFindingsByElement: (map) => set({ lintFindingsByElement: map }),

  beatAnalysis: null,
  setBeatAnalysis: (analysis) => set({ beatAnalysis: analysis }),

  beatEdits: null,
  setBeatEdits: (edits) => set({ beatEdits: edits }),

  beatUndo: [],
  beatRedo: [],
  beatPersist: null,
  setBeatPersist: (fn) => set({ beatPersist: fn }),
  commitBeatEdits: (next, label) => {
    set((s) => ({
      beatEdits: next,
      beatUndo: [...s.beatUndo, { restore: s.beatEdits, at: Date.now(), label }],
      beatRedo: [],
    }));
    get().beatPersist?.();
  },
  undoBeatEdits: () => {
    const s = get();
    const entry = s.beatUndo[s.beatUndo.length - 1];
    if (!entry) return null;
    set({
      beatEdits: entry.restore,
      beatUndo: s.beatUndo.slice(0, -1),
      beatRedo: [...s.beatRedo, { restore: s.beatEdits, at: entry.at, label: entry.label }],
    });
    get().beatPersist?.();
    return entry.label;
  },
  resetBeatHistory: () => set({ beatUndo: [], beatRedo: [] }),
  redoBeatEdits: () => {
    const s = get();
    const entry = s.beatRedo[s.beatRedo.length - 1];
    if (!entry) return null;
    set({
      beatEdits: entry.restore,
      beatRedo: s.beatRedo.slice(0, -1),
      beatUndo: [...s.beatUndo, { restore: s.beatEdits, at: entry.at, label: entry.label }],
    });
    get().beatPersist?.();
    return entry.label;
  },

  clipManifest: null,
  setClipManifest: (clips) => set({ clipManifest: clips }),
  clipParentMap: new Map(),
  setClipParentMap: (map) => set({ clipParentMap: map }),
  domClipChildren: [],
  setDomClipChildren: (children) => set({ domClipChildren: children }),

  setIsPlaying: (playing) => {
    if (get().isPlaying === playing) return;
    set({ isPlaying: playing });
  },
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
  clearSelectedElementIds: () => set({ selectedElementIds: new Set() }),
  setSelectedElementIds: (ids: Set<string>) => set({ selectedElementIds: new Set(ids) }),
  timelineSnapEnabled: readStudioUiPreferences().timelineSnapEnabled ?? true,
  setTimelineSnapEnabled: (enabled) => {
    writeStudioUiPreferences({ timelineSnapEnabled: enabled });
    set({ timelineSnapEnabled: enabled });
  },
  timeDisplayMode: readStudioUiPreferences().timeDisplayMode ?? "time",
  setTimeDisplayMode: (mode) => {
    writeStudioUiPreferences({ timeDisplayMode: mode });
    set({ timeDisplayMode: mode });
  },
  pinTimelineZoom: (currentPixelsPerSecond, fitPixelsPerSecond) =>
    set((s) => {
      // Already pinned (or the user manually zoomed) — never clobber that.
      if (s.zoomMode === "manual") return {};
      const percent = computePinnedZoomPercent(currentPixelsPerSecond, fitPixelsPerSecond);
      writeStudioUiPreferences({
        timelineZoomMode: "manual",
        timelineManualZoomPercent: percent,
      });
      return { zoomMode: "manual", manualZoomPercent: percent };
    }),
  setTimelineScale: (pps, fitPps) => {
    // Non-reactive publish: mutate in place + reuse the same object identity so no
    // subscriber re-renders (these fields are never a render input, only read
    // imperatively before pinning).
    const state = get();
    state.timelinePps = pps;
    state.timelineFitPps = fitPps;
  },
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
  setBeatDragging: (dragging) => set({ beatDragging: dragging }),
  setElements: (elements) => set({ elements }),
  // A genuine single selection: always collapse the set to just this element. User
  // intent (timeline click, preview click via applyDomSelection) flows here; DOM sync
  // echoes that must preserve a group go through setSelectionAnchor instead.
  setSelectedElementId: (id, options) =>
    set((s) => {
      const preserveSet = Boolean(options?.preserveSet && id && s.selectedElementIds.has(id));
      const selectedElementIds = preserveSet
        ? new Set(s.selectedElementIds)
        : options?.preserveSet
          ? new Set<string>()
          : id
            ? new Set([id])
            : new Set<string>();
      // Selecting a different element drops any active keyframe selection — otherwise
      // a stale activeKeyframePct from a prior diamond click would force the next drag
      // to "modify" a keyframe on the new element. A diamond click sets the pct AFTER
      // calling setSelectedElementId, so this never clobbers a genuine keyframe select.
      return id !== s.selectedElementId
        ? {
            selectedElementId: id,
            selectedElementIds,
            activeKeyframePct: null,
            motionPathArmed: false,
          }
        : { selectedElementId: id, selectedElementIds };
    }),
  // Move the anchor within an active multi-selection WITHOUT collapsing it — used by
  // DOM->store sync echoes while a group gesture re-patches the preview. A non-member
  // id is treated as a genuine new single selection.
  setSelectionAnchor: (id) =>
    set((s) => {
      if (id != null && s.selectedElementIds.size > 1 && s.selectedElementIds.has(id)) {
        return { selectedElementId: id };
      }
      return { selectedElementId: id, selectedElementIds: id ? new Set([id]) : new Set<string>() };
    }),
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
      beatDragging: false,
      elements: [],
      selectedElementId: null,
      inPoint: null,
      outPoint: null,
      activeTool: "select",
      selectedKeyframes: new Set(),
      selectedElementIds: new Set(),
      clipRevealRequest: null,
      keyframeCache: new Map(),
      beatAnalysis: null,
      beatEdits: null,
      beatUndo: [],
      beatRedo: [],
      beatPersist: null,
      clipManifest: null,
      clipParentMap: new Map(),
      domClipChildren: [],
    }),
}));

// Bug-bash aid: expose the store so a reproduction can dump live state from the
// console, e.g. `__playerStore.getState().selectedElementId`. Harmless read
// handle; no behavioural effect.
// Only in dev. `import.meta.env` may be undefined in non-Vite bundlers (Next.js
// Turbopack), so guard the access like the telemetry client does.
function isDevBuild(): boolean {
  try {
    return import.meta.env.DEV === true;
  } catch {
    return false;
  }
}
if (isDevBuild() && typeof window !== "undefined") {
  (window as unknown as { __playerStore?: typeof usePlayerStore }).__playerStore = usePlayerStore;
}
