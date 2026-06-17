import type { ReactNode } from "react";
import { useStoryboard } from "../../hooks/useStoryboard";
import { StoryboardDirection } from "./StoryboardDirection";

export interface StoryboardViewProps {
  projectId: string;
}

/**
 * Top-level storyboard stage. Replaces the timeline/preview when the view mode
 * is `storyboard`. PR2 lands the shell (global direction + states); the frame
 * contact-sheet grid arrives in PR3.
 */
// fallow-ignore-next-line complexity
export function StoryboardView({ projectId }: StoryboardViewProps) {
  const { data, loading, error } = useStoryboard(projectId);

  if (loading) return <StoryboardFrame>{<Message>Loading storyboard…</Message>}</StoryboardFrame>;
  if (error) {
    return (
      <StoryboardFrame>
        <Message tone="error">Couldn’t load the storyboard: {error}</Message>
      </StoryboardFrame>
    );
  }
  if (!data) return <StoryboardFrame>{null}</StoryboardFrame>;
  if (!data.exists) {
    return (
      <StoryboardFrame>
        <EmptyState path={data.path} />
      </StoryboardFrame>
    );
  }

  return (
    <StoryboardFrame>
      <StoryboardDirection globals={data.globals} frameCount={data.frames.length} />
      {/* PR3: frame contact-sheet grid renders here. */}
      <div className="mt-8 rounded-lg border border-dashed border-neutral-800 px-6 py-12 text-center text-sm text-neutral-500">
        {data.frames.length} frame{data.frames.length === 1 ? "" : "s"} parsed — the contact sheet
        renders here next.
      </div>
    </StoryboardFrame>
  );
}

function StoryboardFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 min-h-0 overflow-auto bg-neutral-950 text-neutral-200">
      <div className="mx-auto max-w-[1400px] px-8 py-8">{children}</div>
    </div>
  );
}

function Message({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "error" }) {
  return (
    <div
      className={`px-6 py-12 text-center text-sm ${
        tone === "error" ? "text-red-400" : "text-neutral-500"
      }`}
    >
      {children}
    </div>
  );
}

function EmptyState({ path }: { path: string }) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-800 px-6 py-16 text-center">
      <h2 className="text-base font-semibold text-neutral-300">No storyboard yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-neutral-500">
        Add a <code className="rounded bg-neutral-900 px-1 py-0.5 text-neutral-400">{path}</code> at
        the project root to plan this video frame by frame. Your agent can create and iterate on it
        for you.
      </p>
    </div>
  );
}
