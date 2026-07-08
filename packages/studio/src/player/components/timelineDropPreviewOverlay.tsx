import type { TimelineDropPreview } from "./timelineDropPreview";
import { GUTTER, TRACK_H, RULER_H, CLIP_Y } from "./timelineLayout";

export function DropPreviewOverlay({
  preview,
  pps,
  trackIdx,
}: {
  preview: TimelineDropPreview;
  pps: number;
  trackIdx: number;
}) {
  return (
    <>
      <div
        className="absolute pointer-events-none rounded"
        style={{
          left: GUTTER + preview.start * pps,
          top: RULER_H + trackIdx * TRACK_H + CLIP_Y,
          width: Math.max(preview.durationSec * pps, 4),
          height: TRACK_H - CLIP_Y * 2,
          border: "1px dashed rgba(60, 230, 172, 0.8)",
          background: "rgba(60, 230, 172, 0.12)",
          zIndex: 45,
          display: "flex",
          alignItems: "center",
          overflow: "hidden",
        }}
      >
        <span
          className="px-2 text-[10px] font-medium truncate"
          style={{ color: "rgba(60, 230, 172, 0.95)" }}
        >
          {preview.label}
          {preview.extraCount > 0 ? ` +${preview.extraCount} more` : ""}
        </span>
      </div>
      {preview.snapTime != null && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: GUTTER + preview.snapTime * pps,
            top: RULER_H,
            bottom: 0,
            width: 1,
            background: preview.snapType === "playhead" ? "#3CE6AC" : "rgba(255,255,255,0.6)",
            boxShadow: "0 0 6px rgba(60,230,172,0.5)",
            zIndex: 60,
          }}
        />
      )}
    </>
  );
}
