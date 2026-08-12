// ponytail: Playback RAF updates the playhead/time display without per-frame React renders.
type TimeListener = (time: number) => void;
const timeListeners = new Set<TimeListener>();

export const liveTime = {
  notify: (time: number) => timeListeners.forEach((listener) => listener(time)),
  subscribe: (listener: TimeListener) => {
    timeListeners.add(listener);
    return () => timeListeners.delete(listener);
  },
};
