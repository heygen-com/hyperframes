import { useCallback, useEffect, useState } from "react";
import { setFrameStatus, setFrameVoiceover, type FrameStatus } from "@hyperframes/core/storyboard";
import type { StoryboardFrameView } from "../../hooks/useStoryboard";
import { useFileManagerContext } from "../../contexts/FileManagerContext";
import { useViewMode } from "../../contexts/ViewModeContext";
import { Button } from "../ui/Button";
import { FramePoster, posterTime } from "./FramePoster";
import { FRAME_STATUS_META, FRAME_STATUS_ORDER } from "./frameStatus";

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
}

/**
 * Full-area focus on a single frame: large poster, editable voiceover guide,
 * status advancement, full narrative, and a jump into the live preview. Edits
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
}: StoryboardFrameFocusProps) {
  const { readProjectFile, writeProjectFile } = useFileManagerContext();
  const { setViewMode } = useViewMode();
  const [draft, setDraft] = useState(frame.voiceover ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyEdit = useCallback(
    async (edit: (source: string) => string) => {
      if (busy) return; // one read-modify-write at a time; avoids a lost update
      setBusy(true);
      setError(null);
      try {
        const source = await readProjectFile(storyboardPath);
        await writeProjectFile(storyboardPath, edit(source));
        onSaved();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "failed to save");
      } finally {
        setBusy(false);
      }
    },
    [readProjectFile, writeProjectFile, storyboardPath, onSaved, busy],
  );

  const title = frame.title ?? `Frame ${frame.index}`;
  const dirty = draft !== (frame.voiceover ?? "");
  const canOpenPreview = frame.srcExists && Boolean(frame.src);

  const saveVoiceover = useCallback(() => {
    return applyEdit((src) => setFrameVoiceover(src, frame.index, draft));
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
  const confirmLeave = () => !dirty || window.confirm("Discard unsaved voiceover changes?");
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
    if (frame.src) onSelectComposition(frame.src);
    setViewMode("timeline");
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col bg-neutral-950 text-neutral-200">
      <div className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2">
        <button
          type="button"
          onClick={handleBack}
          className="rounded px-2 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-800"
        >
          ← Board
        </button>
        <span className="text-sm font-medium text-neutral-200">
          Frame {frame.number ?? frame.index} — {title}
        </span>
        <div className="ml-auto flex items-center gap-1">
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

      <div className="flex flex-1 min-h-0">
        <div className="flex w-3/5 min-w-0 items-center justify-center bg-neutral-900/40 p-8">
          <div className="aspect-video w-full max-w-[900px] overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
            {canOpenPreview && frame.src ? (
              <FramePoster
                projectId={projectId}
                src={frame.src}
                seconds={posterTime(frame)}
                title={title}
                fit="contain"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm text-neutral-600">
                {frame.status === "outline" ? "Not built yet" : "No preview"}
              </div>
            )}
          </div>
        </div>

        <div className="w-2/5 min-w-0 space-y-6 overflow-auto border-l border-neutral-800 px-6 py-5">
          <StatusRow
            status={frame.status}
            busy={busy}
            onSet={(s) => applyEdit((src) => setFrameStatus(src, frame.index, s))}
          />

          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-neutral-500">
            {frame.duration && <span>Duration {frame.duration}</span>}
            {frame.transitionIn && <span>Transition {frame.transitionIn}</span>}
          </div>

          <section>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                🎙 Voiceover <span className="font-normal normal-case text-neutral-600">guide</span>
              </h3>
              <Button
                size="sm"
                variant="primary"
                onClick={saveVoiceover}
                disabled={!dirty}
                loading={busy}
                className="bg-emerald-600 text-white enabled:hover:bg-emerald-500 shadow-none"
              >
                {busy ? "Saving…" : "Save"}
              </Button>
            </div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                // Same autosave paradigm as the status row above — mixed save
                // models inside one panel taught users the panel autosaves,
                // then lost their voiceover. Explicit Save stays as the
                // affordance; blur is the safety net.
                if (dirty && !busy) void saveVoiceover();
              }}
              rows={3}
              placeholder="What the narrator says over this frame…"
              className="w-full resize-y rounded border border-neutral-800 bg-neutral-900 p-2 text-sm text-neutral-200 outline-none focus:border-neutral-600"
            />
            <p className="mt-1 text-[11px] text-neutral-600">
              A draft guide. SCRIPT.md locks the final narration that drives TTS.
            </p>
            {error && <p className="mt-1 text-[11px] text-red-400">{error}</p>}
          </section>

          {frame.narrative && (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Narrative
              </h3>
              <p className="whitespace-pre-wrap text-sm text-neutral-300">{frame.narrative}</p>
            </section>
          )}

          <Button size="sm" variant="secondary" onClick={openInPreview} disabled={!canOpenPreview}>
            Open in Preview →
          </Button>
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

function StatusRow({
  status,
  busy,
  onSet,
}: {
  status: FrameStatus;
  busy: boolean;
  onSet: (next: FrameStatus) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
        Status
      </span>
      <div className="flex items-center gap-0.5 rounded-md bg-neutral-900 p-0.5">
        {FRAME_STATUS_ORDER.map((option) => (
          <button
            key={option}
            type="button"
            disabled={busy}
            aria-pressed={status === option}
            title={FRAME_STATUS_META[option].tooltip}
            onClick={() => onSet(option)}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
              status === option
                ? "bg-neutral-700 text-neutral-100"
                : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {FRAME_STATUS_META[option].label}
          </button>
        ))}
      </div>
    </div>
  );
}
