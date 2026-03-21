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
}

interface PlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  timelineReady: boolean;
  elements: TimelineElement[];
  selectedElementId: string | null;

  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setTimelineReady: (ready: boolean) => void;
  setElements: (elements: TimelineElement[]) => void;
  setSelectedElementId: (id: string | null) => void;
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

  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),
  setTimelineReady: (ready) => set({ timelineReady: ready }),
  setElements: (elements) => set({ elements }),
  setSelectedElementId: (id) => set({ selectedElementId: id }),
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
    }),
}));
