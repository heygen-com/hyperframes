// Lightweight pub-sub avoids React re-renders on every playback frame.
type TimeListener = (time: number) => void;
const timeListeners = new Set<TimeListener>();

export const liveTime = {
  notify: (time: number) => timeListeners.forEach((listener) => listener(time)),
  subscribe: (listener: TimeListener) => {
    timeListeners.add(listener);
    return () => timeListeners.delete(listener);
  },
};
