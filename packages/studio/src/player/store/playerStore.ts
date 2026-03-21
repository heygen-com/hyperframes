import { create } from "zustand";

export interface TimelineElement {
  id: string;
  tag: string;
  start: number;
  duration: number;
  track: number;
  src?: string;
  playbackStart?: number;
  volume?: number;
  /** Path from data-composition-src — identifies sub-composition elements */
  compositionSrc?: string;
  /** Agent that created/last edited this element */
  agentId?: string;
  /** Agent's color for ownership visualization */
  agentColor?: string;
}

/** Map of elementId → agentColor for clips currently being edited */
export interface ActiveEdits {
  [elementId: string]: { agentId: string; agentColor: string };
}

interface PlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  timelineReady: boolean;
  elements: TimelineElement[];
  selectedElementId: string | null;
  /** Clips currently being edited by agents — for glow animation */
  activeEdits: ActiveEdits;
  playbackRate: number;

  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setPlaybackRate: (rate: number) => void;
  setTimelineReady: (ready: boolean) => void;
  setElements: (elements: TimelineElement[]) => void;
  setSelectedElementId: (id: string | null) => void;
  setActiveEdits: (edits: ActiveEdits) => void;
  updateElementStart: (elementId: string, newStart: number) => void;
  reset: () => void;
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
  activeEdits: {},
  playbackRate: 1,

  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setPlaybackRate: (rate) => set({ playbackRate: rate }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),
  setTimelineReady: (ready) => set({ timelineReady: ready }),
  setElements: (elements) => set({ elements }),
  setSelectedElementId: (id) => set({ selectedElementId: id }),
  setActiveEdits: (edits) => set({ activeEdits: edits }),
  updateElementStart: (elementId, newStart) =>
    set((state) => ({
      elements: state.elements.map((el) => (el.id === elementId ? { ...el, start: newStart } : el)),
    })),
  reset: () =>
    set({
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      timelineReady: false,
      elements: [],
      selectedElementId: null,
      activeEdits: {},
    }),
}));
