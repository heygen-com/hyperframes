import type { StoryboardFrameView } from "../../hooks/useStoryboard";
import { FramePoster, posterTime } from "./FramePoster";
import { FRAME_STATUS_META } from "./frameStatus";

export interface StoryboardFrameTileProps {
  projectId: string;
  frame: StoryboardFrameView;
  /** Open this frame in the full-area focus view. */
  onOpen: (index: number) => void;
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .find((line) => line.trim().length > 0)
      ?.trim() ?? ""
  );
}

function placeholderMessage(frame: StoryboardFrameView): string {
  if (frame.status === "outline") return "Not built yet";
  if (frame.src && !frame.srcExists) return "Frame file not found";
  return "No preview";
}

/** A single contact-sheet tile: poster preview + its metadata. Click to focus. */
// fallow-ignore-next-line complexity
export function StoryboardFrameTile({ projectId, frame, onOpen }: StoryboardFrameTileProps) {
  const meta = FRAME_STATUS_META[frame.status];
  const renderable = frame.srcExists && frame.status !== "outline";
  const title = frame.title ?? `Frame ${frame.index}`;
  const sceneLine = frame.scene ?? firstLine(frame.narrative);

  return (
    <article className="min-w-0">
      <button
        type="button"
        onClick={() => onOpen(frame.index)}
        className="group relative block aspect-video w-full overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 text-left transition-colors hover:border-neutral-600"
      >
        <div className="absolute left-2 top-2 z-10 flex h-6 min-w-6 items-center justify-center rounded-full bg-black/70 px-1.5 text-xs font-semibold text-neutral-100">
          {frame.number ?? frame.index}
        </div>
        {renderable && frame.src ? (
          <FramePoster
            projectId={projectId}
            src={frame.src}
            seconds={posterTime(frame)}
            title={title}
          />
        ) : (
          <FrameTilePlaceholder frame={frame} />
        )}
      </button>

      <div className="mt-2 flex items-start justify-between gap-2">
        <h3 className="truncate text-sm font-medium text-neutral-200">{title}</h3>
        <span
          title={meta.tooltip}
          aria-label={`Status: ${meta.label} — ${meta.tooltip}`}
          className={`shrink-0 cursor-default rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${meta.chipClass}`}
        >
          {meta.label}
        </span>
      </div>
      {sceneLine && <p className="mt-0.5 line-clamp-2 text-xs text-neutral-400">{sceneLine}</p>}
      {frame.voiceover && (
        <p className="mt-1 line-clamp-2 text-xs italic text-neutral-500">
          <span aria-hidden="true">🎙 </span>“{frame.voiceover}”
        </p>
      )}
      <div className="mt-1 flex gap-3 text-[11px] text-neutral-600">
        {frame.duration && <span>{frame.duration}</span>}
        {frame.transitionIn && <span>↘ {frame.transitionIn}</span>}
      </div>
    </article>
  );
}

function FrameTilePlaceholder({ frame }: { frame: StoryboardFrameView }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 border border-dashed border-neutral-700 bg-neutral-950 text-center">
      <span className="text-xs font-medium text-neutral-400">{frame.title ?? "Outline"}</span>
      <span className="text-[11px] text-neutral-600">{placeholderMessage(frame)}</span>
    </div>
  );
}
