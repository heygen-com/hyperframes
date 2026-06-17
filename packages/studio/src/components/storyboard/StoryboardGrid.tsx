import type { StoryboardFrameView } from "../../hooks/useStoryboard";
import { StoryboardFrameTile } from "./StoryboardFrameTile";

export interface StoryboardGridProps {
  projectId: string;
  frames: StoryboardFrameView[];
}

/** The contact sheet: ordered frame tiles in a responsive grid. */
export function StoryboardGrid({ projectId, frames }: StoryboardGridProps) {
  if (frames.length === 0) {
    return (
      <div className="mt-8 rounded-lg border border-dashed border-neutral-800 px-6 py-12 text-center text-sm text-neutral-500">
        This storyboard has no frames yet.
      </div>
    );
  }

  return (
    <div className="mt-8 flex flex-wrap gap-x-6 gap-y-8">
      {frames.map((frame) => (
        <StoryboardFrameTile key={frame.index} projectId={projectId} frame={frame} />
      ))}
    </div>
  );
}
