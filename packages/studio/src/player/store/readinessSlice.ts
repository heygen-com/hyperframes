/** Gates `timelineReady` on the composition's declared readiness inputs
 * (media, compute, and the paint-and-idle default) instead of just a known
 * duration. The generation counter is module-scope, not store state: it
 * guards an in-flight settlement, not something a component reads, so
 * bumping it shouldn't trigger a render. */
import type { StoreApi } from "zustand";
import { settleCompositionReadiness } from "@hyperframes/core/composition-readiness";

export interface PlaybackReadinessSlice {
  timelineReady: boolean;
  /** Latched when the project's first preview shows and can play (or fails), kept through edit
   *  reloads, so work that must not compete with the boot waits for it once. */
  previewBooted: boolean;
  /** Latched when the first preview's opening assets settle (the player's own capped wait) or it
   *  fails. Media reads that fetch those same files wait for it; unlike previewBooted, no deadline. */
  previewAssetsSettled: boolean;
  setTimelineReady: (ready: boolean) => void;
  markPreviewBooted: () => void;
  markPreviewAssetsSettled: () => void;
  /** Sets timelineReady once doc's readiness inputs settle, or immediately
   *  if doc is null. A wait a later call supersedes never wins the race. */
  requestTimelineReady: (doc: Document | null) => void;
}

let timelineReadyGeneration = 0;

/** For a full timeline reset: bumps the generation so any requestTimelineReady
 * wait in flight can never resolve into what replaced it. */
export function resetPlaybackReadinessState(): Pick<
  PlaybackReadinessSlice,
  "timelineReady" | "previewBooted" | "previewAssetsSettled"
> {
  timelineReadyGeneration++;
  return { timelineReady: false, previewBooted: false, previewAssetsSettled: false };
}

export function createPlaybackReadinessSlice(
  set: StoreApi<PlaybackReadinessSlice>["setState"],
): PlaybackReadinessSlice {
  return {
    timelineReady: false,
    previewBooted: false,
    previewAssetsSettled: false,
    markPreviewBooted: () => set({ previewBooted: true }),
    markPreviewAssetsSettled: () => set({ previewAssetsSettled: true }),
    setTimelineReady: (ready) => {
      timelineReadyGeneration++;
      set({ timelineReady: ready });
    },
    requestTimelineReady: (doc) => {
      const generation = ++timelineReadyGeneration;
      if (!doc) return set({ timelineReady: true });
      settleCompositionReadiness(doc, () => {
        if (generation === timelineReadyGeneration) set({ timelineReady: true });
      });
    },
  };
}
