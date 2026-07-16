import type { StoryboardFrameView } from "../../hooks/useStoryboard";
import type { FrameCommentEntry } from "./frameComments";
import { StoryboardFrameTile } from "./StoryboardFrameTile";

export interface StoryboardGridProps {
  projectId: string;
  frames: StoryboardFrameView[];
  /** Open a frame in the full-area focus view. */
  onOpenFrame: (index: number) => void;
  /** Per-frame comment drafts, keyed by frame index. */
  commentDrafts: Record<number, string>;
  onCommentDraftChange: (index: number, text: string) => void;
  /** Submitted comments the agent has not consumed yet. */
  pendingComments: FrameCommentEntry[] | null;
  /** Project signature the board was loaded with (busts poster caches). */
  posterVersion?: string;
}

/** The contact sheet: ordered frame tiles in a responsive grid. */
export function StoryboardGrid({
  projectId,
  frames,
  onOpenFrame,
  commentDrafts,
  onCommentDraftChange,
  pendingComments,
  posterVersion,
}: StoryboardGridProps) {
  if (frames.length === 0) {
    return (
      <div className="mt-8 rounded-lg border border-dashed border-neutral-800 px-6 py-12 text-center text-sm text-neutral-500">
        This storyboard has no frames yet.
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
          commentDraft={commentDrafts[frame.index] ?? ""}
          onCommentDraftChange={onCommentDraftChange}
          pendingComment={
            pendingComments?.find((entry) => entry.frame === frame.index)?.text ?? null
          }
          posterVersion={posterVersion}
        />
      ))}
    </div>
  );
}
