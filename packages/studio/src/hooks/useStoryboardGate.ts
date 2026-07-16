import { useEffect } from "react";
import type { StudioViewMode } from "../contexts/ViewModeContext";
import { shouldFallbackToTimeline } from "../utils/storyboardAvailability";
import { useStoryboard } from "./useStoryboard";

export function useStoryboardGate(
  projectId: string | null,
  viewMode: StudioViewMode,
  setViewMode: (mode: StudioViewMode) => void,
) {
  const storyboard = useStoryboard(projectId);
  const storyboardAvailable = storyboard.loading || Boolean(storyboard.data?.exists);

  useEffect(() => {
    if (shouldFallbackToTimeline(viewMode, storyboard.loading, storyboard.data?.exists)) {
      setViewMode("timeline");
    }
  }, [setViewMode, storyboard.data?.exists, storyboard.loading, viewMode]);

  return { storyboard, storyboardAvailable };
}
