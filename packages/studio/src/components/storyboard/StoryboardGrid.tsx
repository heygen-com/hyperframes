import { useTranslation } from "react-i18next";
import type { StoryboardFrameView } from "../../hooks/useStoryboard";
import { StoryboardFrameTile } from "./StoryboardFrameTile";

export interface StoryboardGridProps {
  projectId: string;
  frames: StoryboardFrameView[];
  /** Open a frame in the full-area focus view. */
  onOpenFrame: (index: number) => void;
}

/** The contact sheet: ordered frame tiles in a responsive grid. */
export function StoryboardGrid({ projectId, frames, onOpenFrame }: StoryboardGridProps) {
  const { t } = useTranslation();

  if (frames.length === 0) {
    return (
      <div className="mt-8 rounded-lg border border-dashed border-neutral-800 px-6 py-12 text-center text-sm text-neutral-500">
        {t("storyboard.noFrames")}
      </div>
    );
  }

  return (
    <div className="mt-8 grid gap-x-6 gap-y-8 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
      {frames.map((frame) => (
        <StoryboardFrameTile
          key={frame.index}
          projectId={projectId}
          frame={frame}
          onOpen={onOpenFrame}
        />
      ))}
    </div>
  );
}
