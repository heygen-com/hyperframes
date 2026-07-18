import { CaretRight } from "@phosphor-icons/react";
import type { TimelineElement } from "../store/playerStore";
import { LABEL_COL_W, TRACK_H } from "./timelineLayout";

// Layer row (Figma order: disclosure ▸/▾, diamond, name) — the disclosure lives
// here, not on the clip bar, and re-expands a collapsed layer.
export function LayerDisclosureRow({
  keyframeClip,
  isExpanded,
  gutterBackground,
  onToggleClipExpanded,
}: {
  keyframeClip: TimelineElement;
  isExpanded: boolean;
  gutterBackground: string;
  onToggleClipExpanded: () => void;
}) {
  const name = keyframeClip.label ?? keyframeClip.domId ?? keyframeClip.id;
  return (
    <div
      className="absolute left-0 top-0 flex items-center gap-1.5 overflow-hidden px-1.5 text-[11px]"
      style={{
        width: LABEL_COL_W,
        height: TRACK_H,
        color: "#ffffff",
        background: gutterBackground,
      }}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? "Collapse" : "Expand"} ${name} keyframes`}
        title={`${isExpanded ? "Collapse" : "Expand"} keyframe lanes`}
        className="flex h-5 w-4 shrink-0 items-center justify-center rounded border-0 bg-transparent p-0 text-white/55 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#3CE6AC]"
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
      <span
        aria-label="Layer keyframe indicator"
        className="shrink-0 text-[13px] leading-none text-white/40"
      >
        ◇
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
    </div>
  );
}
