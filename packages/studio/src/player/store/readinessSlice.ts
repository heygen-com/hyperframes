/** Gates `timelineReady` on the composition's declared readiness inputs
 * (media, compute, and the paint-and-idle default) instead of just a known
 * duration. The generation counter is module-scope, not store state: it
 * guards an in-flight settlement, not something a component reads, so
 * bumping it shouldn't trigger a render. */
import type { StoreApi } from "zustand";
import { settleCompositionReadiness } from "@hyperframes/core/composition-readiness";

export interface PlaybackReadinessSlice {
  timelineReady: boolean;
  /** Latched by the project's first ready preview and kept through edit reloads, so work that
   *  must not compete with boot (card thumbnails) waits for it once. */
  previewBooted: boolean;
  setTimelineReady: (ready: boolean) => void;
  /** A live preview that failed to load has still finished booting. */
  markPreviewBooted: () => void;
  /** Sets timelineReady once doc's readiness inputs settle, or immediately
   *  if doc is null. A wait a later call supersedes never wins the race. */
  requestTimelineReady: (doc: Document | null) => void;
}

let timelineReadyGeneration = 0;

/** For a full timeline reset: bumps the generation so any requestTimelineReady
 * wait in flight can never resolve into what replaced it. */
export function resetPlaybackReadinessState(): Pick<
  PlaybackReadinessSlice,
  "timelineReady" | "previewBooted"
> {
  timelineReadyGeneration++;
  return { timelineReady: false, previewBooted: false };
}

export function createPlaybackReadinessSlice(
  set: StoreApi<PlaybackReadinessSlice>["setState"],
): PlaybackReadinessSlice {
  return {
    timelineReady: false,
    previewBooted: false,
    markPreviewBooted: () => set({ previewBooted: true }),
    setTimelineReady: (ready) => {
      timelineReadyGeneration++;
      set(ready ? { timelineReady: true, previewBooted: true } : { timelineReady: false });
    },
    requestTimelineReady: (doc) => {
      const generation = ++timelineReadyGeneration;
      if (!doc) return set({ timelineReady: true, previewBooted: true });
      settleCompositionReadiness(doc, () => {
        if (generation === timelineReadyGeneration) {
          set({ timelineReady: true, previewBooted: true });
        }
      });
    },
  };
}
