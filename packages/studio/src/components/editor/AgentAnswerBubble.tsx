import { useState, type CSSProperties } from "react";
import { clampNumber } from "../../utils/studioHelpers";
import { AgentGlyph, type AgentJob } from "./agentGlyphs";
import { FLOATING_SURFACE } from "../ui/floatingSurface";
import type { OverlayRect } from "./domEditOverlayGeometry";

const BUBBLE_WIDTH = 268;
const GAP = 10;
/** Enough for a sentence or two; the rest is one click away. */
const COLLAPSED_LINES = 3;

/**
 * Not every instruction is an edit. "Why is this off-centre?" comes back as an
 * answer, and an answer that only lands in a run list is an answer nobody
 * reads — so it is spoken next to the element it is about, where the question
 * was asked.
 */
export function resolveBubblePosition(
  rect: OverlayRect,
  canvas: { width: number; height: number },
  height: number,
): { style: CSSProperties; side: "below" | "above"; tailLeft: number } {
  const below = rect.top + rect.height + GAP;
  const fitsBelow = below + height <= canvas.height - GAP;
  const left = clampNumber(
    rect.left + rect.width / 2 - BUBBLE_WIDTH / 2,
    GAP,
    Math.max(GAP, canvas.width - BUBBLE_WIDTH - GAP),
  );
  // The tail tracks the element's centre, not the bubble's: a bubble pushed
  // along by the canvas edge still has to point back at what it answered.
  const TAIL_INSET = 14;
  const tailLeft = clampNumber(
    rect.left + rect.width / 2 - left,
    TAIL_INSET,
    BUBBLE_WIDTH - TAIL_INSET,
  );

  return {
    style: {
      left,
      top: clampNumber(
        fitsBelow ? below : rect.top - height - GAP,
        GAP,
        Math.max(GAP, canvas.height - height),
      ),
    },
    side: fitsBelow ? "below" : "above",
    tailLeft,
  };
}

export function AgentAnswerBubble({
  job,
  rect,
  canvas,
  agentIconUrl,
  toContainerStyle = (style) => style,
  onDismiss,
  onFollowUp,
}: {
  job: AgentJob;
  rect: OverlayRect;
  canvas: { width: number; height: number };
  agentIconUrl: string | null;
  toContainerStyle?: (style: CSSProperties) => CSSProperties;
  onDismiss: () => void;
  /** Ask a follow-up about the same element, with the answer still on screen. */
  onFollowUp: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const message = job.message?.trim();
  if (!message) return null;

  const { style, side, tailLeft } = resolveBubblePosition(rect, canvas, expanded ? 220 : 108);
  const failed = job.status === "failed" || job.status === "cancelled";

  return (
    <div
      data-agent-answer-bubble="true"
      className={`hf-composer-enter absolute w-[268px] rounded-2xl p-2 ${FLOATING_SURFACE}`}
      style={toContainerStyle(style)}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* The tail points at the element, so the bubble reads as coming from it. */}
      <span
        aria-hidden="true"
        data-agent-answer-tail="true"
        className={`absolute -z-10 size-2.5 -translate-x-1/2 rotate-45 bg-neutral-950 ring-1 ring-white/10 ${
          side === "below" ? "-top-1" : "-bottom-1"
        }`}
        style={{ left: tailLeft }}
      />
      <div className="flex items-start gap-1.5">
        <AgentGlyph kind={job.kind} size={13} iconUrl={agentIconUrl} />
        <p
          className={`min-w-0 flex-1 whitespace-pre-wrap text-[11px] leading-[1.45] ${
            failed ? "text-red-300" : "text-neutral-200"
          } ${expanded ? "" : `line-clamp-${COLLAPSED_LINES}`}`}
        >
          {message}
        </p>
        <button
          className="shrink-0 rounded-md p-0.5 text-neutral-600 transition-colors duration-150 ease-out hover:text-neutral-300 active:scale-[0.96]"
          onClick={onDismiss}
          aria-label="Dismiss this answer"
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-1 pl-[19px]">
        {message.length > 140 && (
          <button
            className="rounded-md px-1.5 py-0.5 text-[10px] leading-none text-neutral-500 transition-colors duration-150 ease-out hover:bg-neutral-800/60 hover:text-neutral-300 active:scale-[0.96]"
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? "Less" : "More"}
          </button>
        )}
        <button
          className="ml-auto rounded-md px-1.5 py-0.5 text-[10px] leading-none text-neutral-500 transition-colors duration-150 ease-out hover:bg-neutral-800/60 hover:text-neutral-200 active:scale-[0.96]"
          onClick={onFollowUp}
        >
          Ask again
        </button>
      </div>
    </div>
  );
}
