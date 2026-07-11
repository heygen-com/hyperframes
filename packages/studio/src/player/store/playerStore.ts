import { create } from "zustand";
import type { MusicBeatAnalysis } from "@hyperframes/core/beats";
import type { BeatEditState } from "../../utils/beatEditing";
import type { ClipManifestClip } from "../lib/playbackTypes";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../../utils/studioUiPreferences";
import { clampTimelineZoomPercent, computePinnedZoomPercent } from "../components/timelineZoom";

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
   * Live CSS stacking order read from the host element during discovery
   * (inline/computed z-index; "auto" ⇒ 0). Canvas paint order only — display
   * lanes are track-derived (stable-track model); the explicit vertical
   * stacking sync in timelineStackingSync updates this on deliberate lane
   * moves (lower lane ⇒ higher z). Absent ⇒ treated as 0.
   */
  zIndex?: number;
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

/** Options for {@link PlayerState.setSelectedElementId}. */
export interface SelectElementOptions {
  /**
   * Keep the current multi-selection set instead of collapsing it. Multi-select
   * flows (marquee, additive click) build the set AFTER writing the primary, and a
   * LATE async primary-selection resolution (e.g. the inspector-opening
   * handleTimelineElementSelect → applyDomSelection path) can re-fire
   * setSelectedElementId with a primary that is ALREADY a member of the live set.
   * Passing preserveSet keeps the set intact in that case. The default (collapse)
   * still guards the original data-loss bug: a fresh single click on a clip that is
   * NOT in the set clears a stale set left over from a previous gesture.
   */
  preserveSet?: boolean;
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
  /** Timeline magnet toggle — when false, clip drags/trims/drops never snap. */
  timelineSnapEnabled: boolean;
  setTimelineSnapEnabled: (enabled: boolean) => void;
  /** Transport + ruler readout: timecode ("time") or frame number ("frame"). */
  timeDisplayMode: "time" | "frame";
  setTimeDisplayMode: (mode: "time" | "frame") => void;
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
  toggleSelectedElementId: (id: string) => void;
  /** Replace the whole multi-selection at once (marquee live updates). */
  setSelectedElementIds: (ids: Set<string>) => void;
  clearSelectedElementIds: () => void;

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
  updateElement: (
    elementId: string,
    updates: Partial<
      Pick<TimelineElement, "start" | "duration" | "track" | "playbackStart" | "hidden" | "zIndex">
    >,
  ) => void;
  setZoomMode: (mode: ZoomMode) => void;
  setManualZoomPercent: (percent: number) => void;
  /**
   * Pin the timeline zoom to the CURRENT on-screen pixels-per-second on the first
   * edit, so a subsequent duration change (which recomputes fit-pps) stops
   * rescaling every clip. No-op once already pinned (mode is "manual") so the
   * user's own manual zoom is never overwritten by a later edit.
   */
  pinTimelineZoom: (currentPixelsPerSecond: number, fitPixelsPerSecond: number) => void;
  /**
   * The timeline's live pixels-per-second + fit basis, published by <Timeline> on
   * every render. Non-reactive scratch state (never read as a render input) so
   * edit handlers OUTSIDE <Timeline> — e.g. the keyboard-delete path — can still
   * pin the zoom via `pinTimelineZoomToCurrent` without threading viewport
   * geometry down to them.
   */
  timelinePps: number;
  timelineFitPps: number;
  setTimelineScale: (pps: number, fitPps: number) => void;
  /** Pin using the last-published live scale (see `pinTimelineZoom`). */
  pinTimelineZoomToCurrent: () => void;
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
  // Hydrate the pinned zoom from prefs so a zoom pinned on a prior edit survives
  // the iframe reload that the edit triggers — the reload/store-init used to snap
  // back to "fit" and rescale every clip when the duration changed.
  zoomMode: readStudioUiPreferences().timelineZoomMode ?? "fit",
  manualZoomPercent: readStudioUiPreferences().timelineManualZoomPercent ?? 100,
  timelinePps: 100,
  timelineFitPps: 100,
  timeDisplayMode: readStudioUiPreferences().timeDisplayMode ?? "time",
  setTimeDisplayMode: (mode) => {
    writeStudioUiPreferences({ timeDisplayMode: mode });
    set({ timeDisplayMode: mode });
  },
  timelineSnapEnabled: readStudioUiPreferences().timelineSnapEnabled ?? true,
  setTimelineSnapEnabled: (enabled) => {
    writeStudioUiPreferences({ timelineSnapEnabled: enabled });
    set({ timelineSnapEnabled: enabled });
  },
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
  toggleSelectedElementId: (id: string) =>
    set((s) => {
      const next = new Set(s.selectedElementIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedElementIds: next };
    }),
  setSelectedElementIds: (ids: Set<string>) => set({ selectedElementIds: new Set(ids) }),
  clearSelectedElementIds: () => set({ selectedElementIds: new Set() }),

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
  setZoomMode: (mode) => {
    writeStudioUiPreferences({ timelineZoomMode: mode });
    set({ zoomMode: mode });
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
    // imperatively by pinTimelineZoomToCurrent).
    const state = get();
    state.timelinePps = pps;
    state.timelineFitPps = fitPps;
  },
  pinTimelineZoomToCurrent: () => {
    const { timelinePps, timelineFitPps, pinTimelineZoom } = get();
    pinTimelineZoom(timelinePps, timelineFitPps);
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
  setManualZoomPercent: (percent) => {
    const clamped = clampTimelineZoomPercent(percent);
    writeStudioUiPreferences({ timelineManualZoomPercent: clamped });
    set({ manualZoomPercent: clamped });
  },
  setCurrentTime: (time) => set({ currentTime: Number.isFinite(time) ? time : 0 }),
  setDuration: (duration) => set({ duration: Number.isFinite(duration) ? duration : 0 }),
  setTimelineReady: (ready) => set({ timelineReady: ready }),
  setBeatDragging: (dragging) => set({ beatDragging: dragging }),
  setElements: (elements) => set({ elements }),
  setSelectedElementId: (id, options) =>
    set((s) => {
      // Selecting a different element drops any active keyframe selection — otherwise
      // a stale activeKeyframePct from a prior diamond click would force the next drag
      // to "modify" a keyframe on the new element. A diamond click sets the pct AFTER
      // calling setSelectedElementId, so this never clobbers a genuine keyframe select.
      const base =
        id !== s.selectedElementId
          ? { selectedElementId: id, activeKeyframePct: null, motionPathArmed: false }
          : { selectedElementId: id };
      // A single-select must collapse any multi-selection: otherwise a stale
      // selectedElementIds set survives and Delete/drag silently act on it (phantom
      // group). Additive flows (marquee, Escape-restore) set the primary FIRST, then
      // repopulate the set, so that ordering leaves their multi-selection intact.
      // A LATE async primary resolution (inspector-open path) lands AFTER the set was
      // written, though, so those flows pass preserveSet to opt out of the collapse
      // when the incoming primary is already a live member of the set.
      if (options?.preserveSet) return base;
      return s.selectedElementIds.size > 0
        ? { ...base, selectedElementIds: new Set<string>() }
        : base;
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
