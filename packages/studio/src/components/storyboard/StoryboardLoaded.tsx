import { useEffect, useMemo, useState } from "react";
import type { StoryboardResponse } from "../../hooks/useStoryboard";
import { Button } from "../ui/Button";
import { StoryboardDirection } from "./StoryboardDirection";
import { StoryboardGrid } from "./StoryboardGrid";
import { StoryboardScriptPanel } from "./StoryboardScriptPanel";
import { StoryboardSourceEditor, type SourceFile } from "./StoryboardSourceEditor";
import { StoryboardFrameFocus } from "./StoryboardFrameFocus";
import { StoryboardReviewGuide } from "./StoryboardReviewGuide";
import {
  AgentChatMessageButton,
  APPLY_STORYBOARD_FEEDBACK_MESSAGE,
} from "./AgentChatMessageButton";
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
  const [feedbackMessageCopied, setFeedbackMessageCopied] = useState(false);
  const comments = useFrameComments(data.frames);
  // When the board refreshes off a project change (agent revised frames), the
  // agent has likely consumed the comments file too — re-check so the pending
  // banner clears the moment revisions land, not on the next window focus.
  const { refreshPending } = comments;
  useEffect(() => {
    void refreshPending();
  }, [data.signature, refreshPending]);
  useEffect(() => {
    if (comments.draftCount > 0) setFeedbackMessageCopied(false);
  }, [comments.draftCount]);

  const saveFeedbackAndCopyMessage = async () => {
    const saved = await comments.submit();
    if (!saved) return;
    try {
      await navigator.clipboard.writeText(APPLY_STORYBOARD_FEEDBACK_MESSAGE);
      setFeedbackMessageCopied(true);
    } catch {
      setFeedbackMessageCopied(false);
    }
  };
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
        scriptExists={Boolean(data.script?.exists)}
        commentDraft={comments.drafts[focusedFrame.index] ?? ""}
        onCommentDraftChange={(text) => comments.setDraft(focusedFrame.index, text)}
        pendingComment={
          comments.pending?.find((entry) => entry.frame === focusedFrame.index)?.text ?? null
        }
        pendingCommentCount={comments.pending?.length ?? 0}
        commentDraftCount={comments.draftCount}
        commentsSubmitState={comments.submitState}
        commentsSubmitError={comments.submitError}
        feedbackMessageCopied={feedbackMessageCopied}
        onFeedbackMessageCopied={() => setFeedbackMessageCopied(true)}
        onSaveFeedback={() => void saveFeedbackAndCopyMessage()}
        posterVersion={data.signature}
      />
    );
  }

  return (
    <div className="flex w-full max-w-[100vw] flex-1 min-h-0 min-w-0 flex-col overflow-hidden bg-neutral-950 text-neutral-200">
      <div className="flex flex-wrap items-center gap-3 border-b border-neutral-800 px-4 py-2">
        <SubViewToggle value={subView} onChange={changeSubView} />
        {subView === "board" && (
          <CommentsSubmitBar
            draftCount={comments.draftCount}
            pendingCount={comments.pending?.length ?? 0}
            submitState={comments.submitState}
            submitError={comments.submitError}
            messageCopied={feedbackMessageCopied}
            onSave={() => void saveFeedbackAndCopyMessage()}
            onMessageCopied={() => setFeedbackMessageCopied(true)}
          />
        )}
      </div>
      {subView === "board" ? (
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="mx-auto max-w-[1400px] px-4 py-5 sm:px-8 sm:py-8">
            <StoryboardDirection globals={data.globals} frameCount={data.frames.length} />
            <StoryboardReviewGuide
              frames={data.frames}
              draftCount={comments.draftCount}
              pendingCount={comments.pending?.length ?? 0}
              onFeedbackMessageCopied={() => setFeedbackMessageCopied(true)}
            />
            <StoryboardWarnings
              warnings={data.warnings}
              onOpenSource={() => changeSubView("source")}
            />
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
  submitError,
  messageCopied,
  onSave,
  onMessageCopied,
}: {
  draftCount: number;
  pendingCount: number;
  submitState: CommentsSubmitState;
  submitError: string | null;
  messageCopied: boolean;
  onSave: () => void;
  onMessageCopied: () => void;
}) {
  return (
    <div className="ml-auto flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:flex-none">
      {pendingCount > 0 && (
        <>
          <span className="text-xs text-sky-300">
            {messageCopied
              ? "Feedback saved · Message copied — paste it in your terminal or IDE agent chat."
              : "Feedback saved · Agent not notified."}
          </span>
          <AgentChatMessageButton
            message={APPLY_STORYBOARD_FEEDBACK_MESSAGE}
            label={messageCopied ? "Copy again" : "Copy prompt for agent"}
            onCopied={onMessageCopied}
          />
        </>
      )}
      {pendingCount === 0 && draftCount === 0 && (
        <span className="text-xs text-neutral-500">Add frame comments to request changes.</span>
      )}
      {submitError && (
        <span className="max-w-64 truncate text-xs text-red-400" title={submitError}>
          Couldn’t submit: {submitError}
        </span>
      )}
      {draftCount > 0 && (
        <Button
          variant="primary"
          size="sm"
          loading={submitState === "saving"}
          disabled={submitState === "saving"}
          onClick={onSave}
        >
          Save &amp; copy message ({draftCount})
        </Button>
      )}
    </div>
  );
}

function StoryboardWarnings({
  warnings,
  onOpenSource,
}: {
  warnings: StoryboardResponse["warnings"];
  onOpenSource: () => void;
}) {
  if (warnings.length === 0) return null;
  return (
    <details className="mt-3 rounded-lg border border-amber-900/60 bg-amber-950/20 px-4 py-2 text-xs text-amber-200">
      <summary className="cursor-pointer font-medium">
        {warnings.length} storyboard warning{warnings.length === 1 ? "" : "s"}
      </summary>
      <ul className="mt-2 space-y-1 text-amber-200/80">
        {warnings.map((warning, index) => (
          <li key={`${warning.line ?? "unknown"}-${index}`}>
            {warning.line ? `Line ${warning.line}: ` : ""}
            {warning.message}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onOpenSource}
        className="mt-2 rounded text-amber-100 underline underline-offset-2 hover:text-white"
      >
        Open source to fix
      </button>
    </details>
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
