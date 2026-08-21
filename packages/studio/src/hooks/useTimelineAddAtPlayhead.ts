import { useCallback } from "react";
import { usePlayerStore } from "../player";

type AddAtPlacement = (path: string, placement: { start: number; track: number }) => unknown;

export function useTimelineAddAtPlayhead(addAsset: AddAtPlacement, addComposition: AddAtPlacement) {
  const placement = () => ({ start: usePlayerStore.getState().currentTime, track: 0 });
  return {
    addAssetAtPlayhead: useCallback((path: string) => addAsset(path, placement()), [addAsset]),
    addCompositionAtPlayhead: useCallback(
      (path: string) => addComposition(path, placement()),
      [addComposition],
    ),
  };
}
