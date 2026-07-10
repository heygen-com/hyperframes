import { useEffect, useMemo, useState } from "react";
import type { StoryboardResponse } from "../../hooks/useStoryboard";
import { Button } from "../ui/Button";
import { StoryboardDirection } from "./StoryboardDirection";
import { StoryboardGrid } from "./StoryboardGrid";
import { StoryboardStatusLegend } from "./StoryboardStatusLegend";
import { StoryboardScriptPanel } from "./StoryboardScriptPanel";
import { StoryboardSourceEditor, type SourceFile } from "./StoryboardSourceEditor";
import { StoryboardFrameFocus } from "./StoryboardFrameFocus";
import { useFrameComments, type CommentsSubmitState } from "./useFrameComments";

type SubView = "board" | "source";

export interface StoryboardLoadedProps {
  projectId: string;
  data: StoryboardResponse;
  /** Re-fetch the manifest after a source edit is saved. */
  reload: () => void;
  /** Select a composition in the timeline (used by "Open in Preview"). */
  onSelectComposition: (path: string) => void;
}

function clampIndex(index: number, count: number): number {
  return Math.max(1, Math.min(count, index));
}

/** A storyboard that exists on disk: Board (contact sheet) ↔ Source ↔ frame focus. */
// fallow-ignore-next-line complexity
export function StoryboardLoaded({
  projectId,
  data,
  reload,
  onSelectComposition,
}: StoryboardLoadedProps) {
  const [subView, setSubView] = useState<SubView>("board");
  const [sourceDirty, setSourceDirty] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const comments = useFrameComments(data.frames);
  // When the board refreshes off a project change (agent revised frames), the
  // agent has likely consumed the comments file too — re-check so the pending
  // banner clears the moment revisions land, not on the next window focus.
  const { refreshPending } = comments;
  useEffect(() => {
    void refreshPending();
  }, [data.signature, refreshPending]);
  const sourceFiles = useMemo<SourceFile[]>(() => {
    const files: SourceFile[] = [{ path: data.path, label: data.path }];
    if (data.script?.exists) files.push({ path: data.script.path, label: data.script.path });
    return files;
    // Depend on the stable fields, not the `data.script` object — every reload()
    // produces a fresh object and would needlessly re-create this array.
  }, [data.path, data.script?.path, data.script?.exists]);

  // Leaving the source editor drops its in-memory buffer; confirm when it's dirty.
  // fallow-ignore-next-line complexity
  const changeSubView = (next: SubView) => {
    if (next === subView) return;
    if (
      subView === "source" &&
      sourceDirty &&
      !window.confirm("Discard unsaved markdown changes?")
    ) {
      return;
    }
    setSubView(next);
  };

  const focusedFrame =
    focusedIndex != null ? (data.frames.find((f) => f.index === focusedIndex) ?? null) : null;

  if (focusedFrame) {
    return (
      <StoryboardFrameFocus
        key={focusedFrame.index}
        projectId={projectId}
        storyboardPath={data.path}
        frame={focusedFrame}
        frameCount={data.frames.length}
        onBack={() => setFocusedIndex(null)}
        onNavigate={(delta) =>
          setFocusedIndex(clampIndex(focusedFrame.index + delta, data.frames.length))
        }
        onSaved={reload}
        onSelectComposition={onSelectComposition}
        posterVersion={data.signature}
      />
    );
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col bg-neutral-950 text-neutral-200">
      <div className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2">
        <SubViewToggle value={subView} onChange={changeSubView} />
        {subView === "board" && (
          <CommentsSubmitBar
            draftCount={comments.draftCount}
            pendingCount={comments.pending?.length ?? 0}
            submitState={comments.submitState}
            onSubmit={() => void comments.submit()}
          />
        )}
      </div>
      {subView === "board" ? (
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="mx-auto max-w-[1400px] px-8 py-8">
            <StoryboardDirection globals={data.globals} frameCount={data.frames.length} />
            <div className="mt-5">
              <StoryboardStatusLegend />
            </div>
            <StoryboardGrid
              projectId={projectId}
              frames={data.frames}
              onOpenFrame={setFocusedIndex}
              commentDrafts={comments.drafts}
              onCommentDraftChange={comments.setDraft}
              pendingComments={comments.pending}
              posterVersion={data.signature}
            />
            {data.script && <StoryboardScriptPanel script={data.script} />}
          </div>
        </div>
      ) : (
        <StoryboardSourceEditor
          files={sourceFiles}
          onSaved={reload}
          onDirtyChange={setSourceDirty}
        />
      )}
    </div>
  );
}

/** Batch-submit the per-frame comment drafts to `.hyperframes/frame-comments.json`. */
function CommentsSubmitBar({
  draftCount,
  pendingCount,
  submitState,
  onSubmit,
}: {
  draftCount: number;
  pendingCount: number;
  submitState: CommentsSubmitState;
  onSubmit: () => void;
}) {
  return (
    <div className="ml-auto flex items-center gap-3">
      {pendingCount > 0 && (
        <span className="text-xs text-sky-300">
          {pendingCount} comment{pendingCount > 1 ? "s" : ""} pending — reply anything in your agent
          chat and it will apply them.
        </span>
      )}
      <Button
        variant="primary"
        size="sm"
        loading={submitState === "saving"}
        disabled={draftCount === 0 || submitState === "saving"}
        onClick={onSubmit}
      >
        {draftCount > 0 ? `Submit comments (${draftCount})` : "Submit comments"}
      </Button>
    </div>
  );
}

const SUB_VIEWS: Array<{ value: SubView; label: string }> = [
  { value: "board", label: "Board" },
  { value: "source", label: "Source" },
];

function SubViewToggle({ value, onChange }: { value: SubView; onChange: (next: SubView) => void }) {
  // Complete tabs contract: roving tabIndex + arrow-key navigation (the roles
  // alone promised keyboard behavior the buttons didn't have).
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const currentIndex = SUB_VIEWS.findIndex((v) => v.value === value);
    const delta = e.key === "ArrowRight" ? 1 : -1;
    const next = SUB_VIEWS[(currentIndex + delta + SUB_VIEWS.length) % SUB_VIEWS.length];
    if (next) onChange(next.value);
  };

  return (
    <div
      className="flex items-center gap-0.5 rounded-md bg-neutral-900 p-0.5"
      role="tablist"
      aria-label="Storyboard view"
      onKeyDown={handleKeyDown}
    >
      {SUB_VIEWS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          onClick={() => onChange(option.value)}
          className={`rounded px-3 py-1 text-xs font-medium transition-colors active:scale-[0.98] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-studio-accent ${
            value === option.value
              ? "bg-neutral-700 text-neutral-100"
              : "text-neutral-400 hover:text-neutral-200"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
