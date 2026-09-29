// ponytail: Playback RAF updates the playhead/time display without per-frame React renders.
type TimeListener = (time: number) => void;
const timeListeners = new Set<TimeListener>();
let latestTime = 0;

export const liveTime = {
  notify: (time: number) => {
    latestTime = time;
    timeListeners.forEach((listener) => listener(time));
  },
  latest: () => latestTime,
  subscribe: (listener: TimeListener) => {
    timeListeners.add(listener);
    return () => timeListeners.delete(listener);
  },
};
