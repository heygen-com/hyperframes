import { CaretRight } from "@phosphor-icons/react";
import type { TimelineElement } from "../store/playerStore";
import { TRACK_H } from "./timelineLayout";
import { TrackClipCount } from "./TrackClipCount";

// Layer row (Figma order: disclosure ▸/▾, diamond, name) — the disclosure lives
// here, not on the clip bar, and re-expands a collapsed layer.
export function LayerDisclosureRow({
  keyframeClip,
  clipCount,
  isExpanded,
  gutterBackground,
  columnWidth,
  lanesId,
  onToggleClipExpanded,
  children,
}: {
  keyframeClip: TimelineElement;
  clipCount: number;
  isExpanded: boolean;
  gutterBackground: string;
  /** Same adaptive width the lane rows use: a narrowed header column must not
   *  leave this row hanging over the clips it labels. */
  columnWidth: number;
  /** Id of the CANVAS-side element holding the diamond lanes this row's caret
   *  expands (see TimelinePropertyLanes). The caret also reveals the per-lane
   *  control rows in this column, but the diamonds are what following the
   *  reference should land on. */
  lanesId: string;
  onToggleClipExpanded: () => void;
  /** Trailing controls that act on the LAYER (the visibility eye), not on a lane. */
  children?: React.ReactNode;
}) {
  const name = keyframeClip.label ?? keyframeClip.domId ?? keyframeClip.id;
  return (
    <div
      className="absolute left-0 top-0 flex items-center gap-1.5 overflow-hidden px-1.5 text-[11px]"
      style={{
        width: columnWidth,
        height: TRACK_H,
        color: "#ffffff",
        background: gutterBackground,
      }}
    >
      <button
        type="button"
        // ponytail: No focus id here; keyboard routing belongs to the enclosing logical row.
        tabIndex={-1}
        aria-expanded={isExpanded}
        aria-controls={lanesId}
        aria-label={`${isExpanded ? "Collapse" : "Expand"} ${name} keyframes`}
        title={`${isExpanded ? "Collapse" : "Expand"} keyframe lanes`}
        // h-6 w-6 = the 24x24 WCAG 2.2 minimum target. The caret glyph stays 11px;
        // only the hit box grows.
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded border-0 bg-transparent p-0 text-white/55 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#3CE6AC]"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onToggleClipExpanded();
        }}
      >
        <CaretRight
          size={11}
          weight="bold"
          aria-hidden="true"
          style={{ transform: isExpanded ? "rotate(90deg)" : undefined }}
        />
      </button>
      {/* Decorative: the disclosure button above already names the row's keyframe
          state, and aria-label on a plain span is not exposed reliably anyway. */}
      <span aria-hidden="true" className="shrink-0 text-[13px] leading-none text-white/40">
        ◇
      </span>
      <span className="min-w-0 flex-1 truncate font-medium" title={name}>
        {name}
      </span>
      <TrackClipCount clipCount={clipCount} />
      {children}
    </div>
  );
}
