import { useCallback, useEffect, useState } from "react";
import { setFrameVoiceover } from "@hyperframes/core/storyboard";
import type { StoryboardFrameView } from "../../hooks/useStoryboard";
import { useFileManagerContext } from "../../contexts/FileManagerContext";
import { useViewMode } from "../../contexts/ViewModeContext";
import { Button } from "../ui/Button";
import { FramePoster, posterTime } from "./FramePoster";
import {
  AgentChatMessageButton,
  APPLY_STORYBOARD_FEEDBACK_MESSAGE,
} from "./AgentChatMessageButton";
import { FRAME_STATUS_META } from "./frameStatus";
import type { CommentsSubmitState } from "./useFrameComments";

export interface StoryboardFrameFocusProps {
  projectId: string;
  /** Path to STORYBOARD.md (edits are written here). */
  storyboardPath: string;
  frame: StoryboardFrameView;
  frameCount: number;
  onBack: () => void;
  onNavigate: (delta: number) => void;
  /** Re-parse the manifest after an edit is saved. */
  onSaved: () => void;
  /** Select a composition in the timeline (sets active comp + editing file + sidebar highlight). */
  onSelectComposition: (path: string) => void;
  /** Whether SCRIPT.md exists and owns final narration/TTS. */
  scriptExists: boolean;
  /** Shared board draft for this frame, preserved when entering/leaving focus. */
  commentDraft: string;
  onCommentDraftChange: (text: string) => void;
  pendingComment: string | null;
  pendingCommentCount: number;
  commentDraftCount: number;
  commentsSubmitState: CommentsSubmitState;
  commentsSubmitError: string | null;
  feedbackMessageCopied: boolean;
  onFeedbackMessageCopied: () => void;
  onSaveFeedback: () => void;
  /** Project signature the board was loaded with (busts the poster cache). */
  posterVersion?: string;
}

/**
 * Full-area focus on a single frame: large poster, editable voiceover guide,
 * review feedback, full narrative, and a jump into the live preview. Edits
 * are written back to STORYBOARD.md in place (markdown stays canonical).
 *
 * Mounted with a `key` per frame, so `draft` initializes from the frame and a
 * save-triggered reload never clobbers in-progress typing.
 */
// fallow-ignore-next-line complexity
export function StoryboardFrameFocus({
  projectId,
  storyboardPath,
  frame,
  frameCount,
  onBack,
  onNavigate,
  onSaved,
  onSelectComposition,
  scriptExists,
  commentDraft,
  onCommentDraftChange,
  pendingComment,
  pendingCommentCount,
  commentDraftCount,
  commentsSubmitState,
  commentsSubmitError,
  feedbackMessageCopied,
  onFeedbackMessageCopied,
  onSaveFeedback,
  posterVersion,
}: StoryboardFrameFocusProps) {
  const { readProjectFile, writeProjectFile } = useFileManagerContext();
  const { setViewMode, registerViewModeGuard } = useViewMode();
  const [draft, setDraft] = useState(frame.voiceover ?? "");
  const [savedVoiceover, setSavedVoiceover] = useState(frame.voiceover ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyEdit = useCallback(
    async (edit: (source: string) => string) => {
      if (busy) return false; // one read-modify-write at a time; avoids a lost update
      setBusy(true);
      setError(null);
      try {
        const source = await readProjectFile(storyboardPath);
        await writeProjectFile(storyboardPath, edit(source));
        onSaved();
        return true;
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "failed to save");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [readProjectFile, writeProjectFile, storyboardPath, onSaved, busy],
  );

  const title = frame.title ?? `Frame ${frame.index}`;
  const dirty = draft !== savedVoiceover;
  const canOpenPreview = frame.status !== "outline" && frame.srcExists && Boolean(frame.src);

  const saveVoiceover = useCallback(async () => {
    const saved = await applyEdit((src) => setFrameVoiceover(src, frame.index, draft));
    if (saved) setSavedVoiceover(draft);
  }, [applyEdit, frame.index, draft]);

  // Closing the tab with a dirty voiceover would lose it silently — same
  // guard the sibling markdown editor registers for the same class of loss.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Leaving the frame drops the in-memory voiceover draft; confirm while it's
  // dirty. An in-flight save does NOT count as safe: if it fails after unmount
  // the error lands on an unmounted component and the draft is silently lost,
  // so keep confirming until the save actually lands (dirty clears on success).
  const confirmLeave = useCallback(
    () => !dirty || window.confirm("Discard unsaved voiceover changes?"),
    [dirty],
  );
  useEffect(() => registerViewModeGuard(confirmLeave), [confirmLeave, registerViewModeGuard]);

  const handleBack = () => {
    if (confirmLeave()) onBack();
  };
  const handleNavigate = (delta: number) => {
    if (confirmLeave()) onNavigate(delta);
  };

  // ←/→ navigate frames, Esc returns to the Board — but never while typing in a field.
  useEffect(() => {
    // fallow-ignore-next-line complexity
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return;
      if (e.key === "Escape") handleBack();
      else if (e.key === "ArrowLeft" && frame.index > 1) handleNavigate(-1);
      else if (e.key === "ArrowRight" && frame.index < frameCount) handleNavigate(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const openInPreview = () => {
    if (!setViewMode("timeline")) return;
    if (frame.src) onSelectComposition(frame.src);
  };

  return (
    <div className="flex w-full max-w-[100vw] flex-1 min-h-0 min-w-0 flex-col overflow-hidden bg-neutral-950 text-neutral-200">
      <div className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2">
        <button
          type="button"
          onClick={handleBack}
          className="rounded px-2 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-800"
        >
          ← Board
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-200">
          Frame {frame.number ?? frame.index} — {title}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <NavButton
            label="‹ Prev"
            disabled={frame.index <= 1}
            onClick={() => handleNavigate(-1)}
          />
          <NavButton
            label="Next ›"
            disabled={frame.index >= frameCount}
            onClick={() => handleNavigate(1)}
          />
        </div>
      </div>

      {(commentDraftCount > 0 || pendingCommentCount > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800 bg-neutral-900/80 px-4 py-2">
          <div>
            <div className="text-xs font-medium text-neutral-200">
              {commentDraftCount > 0 ? "Feedback ready to save" : "Feedback saved"}
            </div>
            <div className="text-[11px] text-neutral-500">
              {commentDraftCount > 0
                ? "Save this batch and copy the message for your agent."
                : feedbackMessageCopied
                  ? "Message copied — paste it in your terminal or IDE agent chat."
                  : "The agent has not been notified yet."}
            </div>
          </div>
          {commentDraftCount > 0 ? (
            <Button
              size="sm"
              variant="primary"
              onClick={onSaveFeedback}
              loading={commentsSubmitState === "saving"}
            >
              Save &amp; copy message ({commentDraftCount})
            </Button>
          ) : (
            <AgentChatMessageButton
              message={APPLY_STORYBOARD_FEEDBACK_MESSAGE}
              label={feedbackMessageCopied ? "Copy again" : "Copy prompt for agent"}
              onCopied={onFeedbackMessageCopied}
            />
          )}
        </div>
      )}

      <div className="flex flex-1 min-h-0 flex-col overflow-auto lg:flex-row lg:overflow-hidden">
        <div className="flex w-full shrink-0 items-center justify-center bg-neutral-900/40 p-4 sm:p-8 lg:h-full lg:w-3/5">
          <div className="aspect-video w-full max-w-[900px] overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
            {canOpenPreview && frame.src ? (
              <FramePoster
                projectId={projectId}
                src={frame.src}
                seconds={posterTime(frame)}
                title={title}
                fit="contain"
                posterVersion={posterVersion}
              />
            ) : (
              <FramePlan frame={frame} />
            )}
          </div>
        </div>

        <div className="w-full shrink-0 space-y-6 border-t border-neutral-800 px-4 py-5 sm:px-6 lg:h-full lg:w-2/5 lg:overflow-auto lg:border-t-0 lg:border-l">
          <ReadOnlyStatus status={frame.status} />

          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-neutral-500">
            {frame.duration && <span>Duration {frame.duration}</span>}
            {frame.transitionIn && <span>Transition {frame.transitionIn}</span>}
          </div>

          <section>
            <div className="mb-1 flex items-center justify-between">
              <h3
                className="text-xs font-semibold uppercase tracking-wider text-neutral-400"
                title="Storyboard voiceover is a guide; SCRIPT.md is the final TTS source."
              >
                🎙 Voiceover <span className="font-normal normal-case text-neutral-600">guide</span>
              </h3>
              <Button
                size="sm"
                variant="primary"
                onClick={saveVoiceover}
                disabled={!dirty}
                loading={busy}
              >
                {busy ? "Saving…" : "Save voiceover"}
              </Button>
            </div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              placeholder="What the narrator says over this frame…"
              className="w-full resize-y rounded border border-neutral-800 bg-neutral-900 p-2 text-sm text-neutral-200 outline-none focus:border-neutral-600"
            />
            <p className="mt-1 text-[11px] text-neutral-600">
              {dirty
                ? "Unsaved changes"
                : scriptExists
                  ? "Saved. SCRIPT.md drives final TTS."
                  : "Saved to STORYBOARD.md. This voiceover guides narration for the frame."}
            </p>
            {error && <p className="mt-1 text-[11px] text-red-400">{error}</p>}
          </section>

          <section>
            <div className="mb-1">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Frame feedback
              </h3>
            </div>
            <textarea
              value={commentDraft}
              onChange={(e) => onCommentDraftChange(e.target.value)}
              rows={3}
              placeholder="Tell your agent what to change in this frame…"
              aria-label={`Comment on ${title}`}
              className="w-full resize-y rounded border border-neutral-800 bg-neutral-900 p-2 text-sm text-neutral-200 placeholder:text-neutral-600 outline-none focus:border-sky-700"
            />
            {pendingCommentCount > 0 ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-sky-900/70 bg-sky-950/20 px-2.5 py-2">
                <p className="text-[11px] text-sky-200">
                  Paste the agent prompt in your terminal or IDE chat.
                </p>
                <AgentChatMessageButton
                  message={APPLY_STORYBOARD_FEEDBACK_MESSAGE}
                  onCopied={onFeedbackMessageCopied}
                />
              </div>
            ) : (
              <p className="mt-1 text-[11px] text-neutral-600">
                {commentDraftCount > 0
                  ? "Your change is ready. Save it using the review bar above."
                  : "Add a change to prepare feedback for the agent."}
              </p>
            )}
            {pendingComment && (
              <p className="mt-1 text-[11px] text-sky-400/90">
                <span className="font-medium">Pending:</span> “{pendingComment}”
              </p>
            )}
            {commentsSubmitError && (
              <p className="mt-1 text-[11px] text-red-400">
                Couldn’t submit: {commentsSubmitError}
              </p>
            )}
          </section>

          {frame.narrative && (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Narrative
              </h3>
              <p className="whitespace-pre-wrap text-sm text-neutral-300">{frame.narrative}</p>
            </section>
          )}

          {canOpenPreview ? (
            <Button size="sm" variant="secondary" onClick={openInPreview}>
              Open in Preview →
            </Button>
          ) : (
            <div className="rounded-md border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-xs text-neutral-500">
              Preview becomes available after your agent builds this frame.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NavButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded px-2 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-800 enabled:active:scale-[0.98] transition-transform disabled:opacity-30"
    >
      {label}
    </button>
  );
}

function ReadOnlyStatus({ status }: { status: StoryboardFrameView["status"] }) {
  const meta = FRAME_STATUS_META[status];
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
        Status
      </span>
      <span className={`rounded px-2 py-1 text-xs font-medium ${meta.chipClass}`}>
        {meta.label}
      </span>
      <span className="text-[11px] text-neutral-600">Updated by your agent</span>
    </div>
  );
}

// The empty state selects copy from frame status and whichever storyboard fields are available.
// fallow-ignore-next-line complexity
function FramePlan({ frame }: { frame: StoryboardFrameView }) {
  const title = frame.title ?? `Frame ${frame.index}`;
  const isOutline = frame.status === "outline";
  return (
    <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_center,_rgba(38,38,38,0.8),_rgba(10,10,10,1))] p-10">
      <div className="max-w-xl text-center">
        <span className="rounded-full border border-neutral-700 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
          {isOutline ? "Planned frame" : "Preview unavailable"}
        </span>
        <h2 className="mt-4 text-2xl font-semibold text-neutral-100">{title}</h2>
        {frame.scene && (
          <p className="mt-3 text-base leading-relaxed text-neutral-300">{frame.scene}</p>
        )}
        {!frame.scene && frame.narrative && (
          <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-neutral-400">
            {frame.narrative}
          </p>
        )}
        <p className="mt-5 text-xs text-neutral-600">
          {isOutline
            ? "A visual preview will appear when your agent builds the sketch."
            : frame.src
              ? `Frame file not found: ${frame.src}`
              : "This frame does not link to a source file."}
        </p>
      </div>
    </div>
  );
}
