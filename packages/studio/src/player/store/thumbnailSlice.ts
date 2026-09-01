import type { StoreApi } from "zustand";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../../utils/studioUiPreferences";
import { defaultThumbnailMode, type ThumbnailMode } from "../lib/thumbnailPolicy";

export interface ThumbnailSlice {
  thumbnailMode: ThumbnailMode;
  /** Monotonic identity for persisted project content shown by mounted thumbnails. */
  thumbnailContentRevision: number;
  setThumbnailMode: (mode: ThumbnailMode) => void;
  bumpThumbnailContentRevision: () => void;
}

export function createThumbnailSlice(set: StoreApi<ThumbnailSlice>["setState"]): ThumbnailSlice {
  return {
    thumbnailMode: defaultThumbnailMode(readStudioUiPreferences().thumbnailMode),
    thumbnailContentRevision: 0,
    setThumbnailMode: (mode) => {
      writeStudioUiPreferences({ thumbnailMode: mode });
      set({ thumbnailMode: mode });
    },
    bumpThumbnailContentRevision: () =>
      set((state) => ({ thumbnailContentRevision: state.thumbnailContentRevision + 1 })),
  };
}
