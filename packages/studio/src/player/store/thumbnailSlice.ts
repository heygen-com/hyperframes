import type { StoreApi } from "zustand";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../../utils/studioUiPreferences";
import { defaultThumbnailMode, type ThumbnailMode } from "../lib/thumbnailPolicy";

export interface ThumbnailSlice {
  thumbnailMode: ThumbnailMode;
  setThumbnailMode: (mode: ThumbnailMode) => void;
}

export function createThumbnailSlice(set: StoreApi<ThumbnailSlice>["setState"]): ThumbnailSlice {
  return {
    thumbnailMode: defaultThumbnailMode(readStudioUiPreferences().thumbnailMode),
    setThumbnailMode: (mode) => {
      writeStudioUiPreferences({ thumbnailMode: mode });
      set({ thumbnailMode: mode });
    },
  };
}
