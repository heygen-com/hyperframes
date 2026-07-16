import type { StudioViewMode } from "../contexts/ViewModeContext";

export function shouldFallbackToTimeline(
  viewMode: StudioViewMode,
  storyboardLoading: boolean,
  storyboardExists: boolean | undefined,
): boolean {
  return viewMode === "storyboard" && !storyboardLoading && storyboardExists === false;
}
