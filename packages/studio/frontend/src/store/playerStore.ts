import { create } from "zustand";

export interface TimelineElement {
  id: string;
  tag: string;
  start: number;
  duration: number;
  track: number;
  src?: string;
  mediaStart?: number;
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
      elements: state.elements.map((el) =>
        el.id === elementId ? { ...el, start: newStart } : el
      ),
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
