/** Gates `timelineReady` on the composition's declared readiness inputs
 * (media, for now) instead of just a known duration. The generation counter
 * is module-scope, not store state: it guards an in-flight settlement, not
 * something a component reads, so bumping it shouldn't trigger a render. */
import type { StoreApi } from "zustand";
import { settleCompositionReadiness } from "@hyperframes/core/composition-readiness";

export interface PlaybackReadinessSlice {
  timelineReady: boolean;
  setTimelineReady: (ready: boolean) => void;
  /** Sets timelineReady once doc's readiness inputs settle, or immediately
   *  if doc is null. A wait a later call supersedes never wins the race. */
  requestTimelineReady: (doc: Document | null) => void;
}

let timelineReadyGeneration = 0;

export function createPlaybackReadinessSlice(
  set: StoreApi<PlaybackReadinessSlice>["setState"],
): PlaybackReadinessSlice {
  return {
    timelineReady: false,
    setTimelineReady: (ready) => set({ timelineReady: ready }),
    requestTimelineReady: (doc) => {
      const generation = ++timelineReadyGeneration;
      if (!doc) return set({ timelineReady: true });
      settleCompositionReadiness(doc, () => {
        if (generation === timelineReadyGeneration) set({ timelineReady: true });
      });
    },
  };
}
