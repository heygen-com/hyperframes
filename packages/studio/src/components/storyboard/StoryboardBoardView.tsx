import { useCallback, useEffect, useState } from "react";
import { trackStudioEvent } from "../../utils/studioTelemetry";
import { OpenInDesktopButton } from "../OpenInDesktopButton";
import { ApproveBoardButton } from "./ApproveBoardButton";
import { Button, cn } from "../ui";
import { groupByAct, stillPath, type BoardFrame } from "./storyboardBoard";
import { projectFileUrl, type StoryboardBoard } from "./useStoryboardBoard";

interface Props {
  projectId: string;
  board: StoryboardBoard & { path: string };
  /** Back to the film, at a moment of it. */
  onShowInPreview: (seconds: number | null) => void;
}

/** A frame's start in seconds, from its "a to b" range; null when it has none. */
export const frameStart = (time: string): number | null => {
  const at = /(\d+(?:\.\d+)?)/.exec(time)?.[1];
  return at === undefined ? null : Number(at);
};

/** What the board area shows: the page as written, a wait, or the frames; and why, when it is not the frames. */
export function boardMode(
  read: StoryboardBoard["read"],
  asWritten: boolean,
): { mode: "page" | "loading" | "frames"; frames: BoardFrame[]; reason: string | null } {
  if (read.state === "failed")
    return { mode: "page", frames: [], reason: "Couldn't read the page, shown as written" };
  if (read.state === "loading") return { mode: "loading", frames: [], reason: null };
  if (!read.frames.length)
    return { mode: "page", frames: [], reason: "No frames found, shown as written" };
  return { mode: asWritten ? "page" : "frames", frames: read.frames, reason: null };
}

/**
 * The storyboard, drawn by Studio from the frames the agent's page holds: a board of stills, and one frame at a time.
 * Notes, drawings and the go are Desktop's (they go to its agent), so the bar hands the project there.
 */
export function StoryboardBoardView({ projectId, board, onShowInPreview }: Props) {
  const [asWritten, setAsWritten] = useState(false);
  const { mode, frames, reason } = boardMode(board.read, asWritten);
  const still = (frame: BoardFrame): string | null => {
    const path = stillPath(board.path, frame.still);
    return path ? projectFileUrl(projectId, path, board.revision) : null;
  };

  return (
    <div
      className="flex h-full w-full min-w-0 flex-col bg-neutral-950"
      data-testid="storyboard-board"
    >
      <BoardBar
        path={board.path}
        count={frames.length}
        asWritten={mode === "page"}
        canToggle={reason === null && mode !== "loading"}
        onToggle={() => {
          trackStudioEvent("storyboard_action", { action: asWritten ? "board" : "as_written" });
          setAsWritten((v) => !v);
        }}
        reason={reason}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {mode === "page" && (
          <PageAsWritten url={projectFileUrl(projectId, board.path, board.revision)} />
        )}
        {mode === "loading" && (
          <p className="p-6 text-step-11 text-text-4">Reading the storyboard…</p>
        )}
        {mode === "frames" && (
          <FramesBody frames={frames} still={still} onShowInPreview={onShowInPreview} />
        )}
      </div>
    </div>
  );
}

/** The board of stills, or one frame of it. */
function FramesBody({
  frames,
  still,
  onShowInPreview,
}: {
  frames: BoardFrame[];
  still: (frame: BoardFrame) => string | null;
  onShowInPreview: (seconds: number | null) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    if (open !== null && open >= frames.length) setOpen(frames.length ? frames.length - 1 : null);
  }, [frames.length, open]);
  const frame = open === null ? undefined : frames[open];
  if (!frame || open === null)
    return (
      <BoardGrid
        frames={frames}
        still={still}
        onOpen={(i) => {
          trackStudioEvent("storyboard_action", { action: "open_frame" });
          setOpen(i);
        }}
      />
    );
  return (
    <OpenFrame
      frame={frame}
      index={open}
      count={frames.length}
      src={still(frame)}
      onStep={(to) => setOpen(Math.max(0, Math.min(frames.length - 1, to)))}
      onClose={() => setOpen(null)}
      onShowInPreview={() => {
        trackStudioEvent("storyboard_action", { action: "show_in_preview" });
        onShowInPreview(frameStart(frame.time));
      }}
    />
  );
}

function BoardBar({
  path,
  count,
  asWritten,
  canToggle,
  onToggle,
  reason,
}: {
  path: string;
  count: number;
  asWritten: boolean;
  canToggle: boolean;
  onToggle: () => void;
  reason: string | null;
}) {
  return (
    <div className="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border-strong bg-surface px-3 py-1">
      <div className="flex min-w-0 items-center gap-2 text-step-11">
        <span className="font-semibold text-text-0">Storyboard</span>
        {count > 0 && !asWritten && <span className="text-text-3">{count} frames</span>}
        <span className="truncate text-text-4" title={path}>
          {reason ?? path}
        </span>
        {canToggle && (
          <Button variant="ghost" size="sm" onClick={onToggle}>
            {asWritten ? "Show as board" : "Show page as written"}
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-step-10 text-text-3 max-[1100px]:hidden">
          Approve to have your agent build it. Comments on frames are in the desktop app
        </span>
        <ApproveBoardButton />
        <OpenInDesktopButton placement="storyboard" />
      </div>
    </div>
  );
}

function BoardGrid({
  frames,
  still,
  onOpen,
}: {
  frames: BoardFrame[];
  still: (frame: BoardFrame) => string | null;
  onOpen: (index: number) => void;
}) {
  let index = 0;
  return (
    <div className="flex flex-col gap-6 p-4">
      {groupByAct(frames).map((group, g) => (
        <section key={`${g}:${group.act}`} className="flex flex-col gap-3">
          {group.act && (
            <h3 className="text-step-10 font-semibold tracking-wide text-accent uppercase">
              {group.act}
            </h3>
          )}
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
            {group.frames.map((frame) => {
              const at = index++;
              const src = still(frame);
              return (
                <button
                  key={`${at}:${frame.number}`}
                  type="button"
                  onClick={() => onOpen(at)}
                  className="group flex flex-col overflow-hidden rounded-lg border border-border-strong bg-neutral-900 text-left outline-hidden hover:border-accent focus-visible:border-accent"
                  aria-label={`Frame ${frame.number}: ${frame.title}`}
                >
                  <div className="flex aspect-video w-full items-center justify-center bg-black">
                    {src ? (
                      <img
                        src={src}
                        alt=""
                        className="h-full w-full object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <span className="text-step-11 text-text-4">Not sketched yet</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5 p-2.5">
                    <span className="truncate text-step-11 font-semibold text-text-0">
                      {frame.number}: {frame.title || "Untitled"}
                    </span>
                    {frame.time && (
                      <span className="text-step-10 tabular-nums text-text-3">{frame.time}</span>
                    )}
                    {frame.words && (
                      <span className="line-clamp-2 text-step-10 text-text-2">{frame.words}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function OpenFrame({
  frame,
  index,
  count,
  src,
  onStep,
  onClose,
  onShowInPreview,
}: {
  frame: BoardFrame;
  index: number;
  count: number;
  src: string | null;
  onStep: (to: number) => void;
  onClose: () => void;
  onShowInPreview: () => void;
}) {
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      if (e.key === "ArrowLeft") onStep(index - 1);
      else if (e.key === "ArrowRight") onStep(index + 1);
      else if (e.key === "Escape") onClose();
      else return;
      e.preventDefault();
      e.stopPropagation();
    },
    [index, onStep, onClose],
  );
  useEffect(() => {
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onKey]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          ← Whole board
        </Button>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={index === 0}
            onClick={() => onStep(index - 1)}
          >
            Back
          </Button>
          <span className="px-1 text-step-11 tabular-nums text-text-2">
            {index + 1} / {count}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={index >= count - 1}
            onClick={() => onStep(index + 1)}
          >
            Next
          </Button>
        </div>
        <Button variant="ghost" size="sm" onClick={onShowInPreview}>
          Show in preview
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg bg-black">
        {src ? (
          <img src={src} alt="" className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-step-12 text-text-4">Not sketched yet</span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-step-12 font-semibold text-text-0">
          {frame.number}: {frame.title || "Untitled"}
          {frame.time && (
            <span className="ml-2 font-normal tabular-nums text-text-3">{frame.time}</span>
          )}
        </span>
        {frame.words && <p className="text-step-11 text-text-2">{frame.words}</p>}
      </div>
    </div>
  );
}

/** The agent's page itself, its scripts off: what a board Studio cannot read into frames still looks like. */
function PageAsWritten({ url }: { url: string }) {
  return (
    <iframe
      key={url}
      title="Storyboard page"
      src={url}
      sandbox=""
      referrerPolicy="no-referrer"
      className={cn("h-full w-full border-0 bg-white")}
    />
  );
}
