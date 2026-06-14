import { memo, useRef, useState } from "react";
import { moveBeatCompositionTime, deleteBeatAtCompositionTime } from "../../utils/beatEditActions";
import { usePlayerStore } from "../store/playerStore";

const BEAT_BAND_H = 14; // dark band height at top of track
const BEAT_HIT_W = 12; // grab width per beat (px)

/**
 * Green beat dots on the music track's row. Drag a dot to move its beat,
 * double-click to delete; both scrub the audio. Dot size/brightness scale with
 * beat loudness (gamma-curved for contrast).
 */
export const BeatStrip = memo(function BeatStrip({
  beatTimes,
  beatStrengths,
  pps,
}: {
  beatTimes: number[] | undefined;
  beatStrengths: number[] | undefined;
  pps: number;
}) {
  // Active drag: which beat and how far (px) it's been dragged.
  const [drag, setDrag] = useState<{ index: number; dx: number } | null>(null);
  const dragRef = useRef<{ index: number; startX: number; origTime: number } | null>(null);

  if (!beatTimes || beatTimes.length < 2) return null;
  const avgInterval = (beatTimes[beatTimes.length - 1]! - beatTimes[0]!) / (beatTimes.length - 1);
  if (avgInterval * pps < 5) return null;
  const cy = BEAT_BAND_H / 2;

  return (
    <div
      className="absolute left-0 right-0 top-0 pointer-events-none"
      style={{ height: BEAT_BAND_H, background: "rgba(0,0,0,0.28)", zIndex: 11 }}
    >
      {beatTimes.map((t, i) => {
        // Louder beats → larger, brighter dot. Gamma curve widens the contrast.
        const strength = Math.pow(Math.min(1, beatStrengths?.[i] ?? 0.5), 2.2);
        const r = 1.5 + strength * 2.5;
        const opacity = 0.25 + strength * 0.75;
        const dxPx = drag?.index === i ? drag.dx : 0;
        const x = t * pps + dxPx;
        return (
          <div
            key={`${t}-${i}`}
            className="absolute select-none"
            title="Drag to move · double-click to delete"
            draggable={false}
            style={{
              left: x - BEAT_HIT_W / 2,
              top: 0,
              width: BEAT_HIT_W,
              height: BEAT_BAND_H,
              cursor: "ew-resize",
              pointerEvents: "auto",
              touchAction: "none",
            }}
            onPointerDown={(e) => {
              // preventDefault stops the browser starting a native text/drag
              // selection (which otherwise "selects" the whole panel mid-drag).
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              dragRef.current = { index: i, startX: e.clientX, origTime: t };
              setDrag({ index: i, dx: 0 });
              usePlayerStore.getState().requestSeek(Math.max(0, t)); // scrub audio at beat
            }}
            onPointerMove={(e) => {
              const d = dragRef.current;
              if (!d || d.index !== i) return;
              e.preventDefault();
              const dx = e.clientX - d.startX;
              setDrag({ index: i, dx });
              // Scrub the audio (and move the playhead) to follow the dragged beat.
              usePlayerStore.getState().requestSeek(Math.max(0, d.origTime + dx / pps));
            }}
            onPointerUp={(e) => {
              const d = dragRef.current;
              dragRef.current = null;
              setDrag(null);
              if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
              }
              if (!d || d.index !== i) return;
              const dx = e.clientX - d.startX;
              if (Math.abs(dx) > 2) {
                const newTime = Math.max(0, d.origTime + dx / pps);
                moveBeatCompositionTime(d.origTime, newTime);
                usePlayerStore.getState().requestSeek(newTime); // park scrubber at new beat
              }
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              deleteBeatAtCompositionTime(t);
              usePlayerStore.getState().requestSeek(Math.max(0, t)); // park scrubber at deleted beat
            }}
          >
            <div
              className="absolute"
              style={{
                left: BEAT_HIT_W / 2 - r,
                top: cy - r,
                width: r * 2,
                height: r * 2,
                borderRadius: "50%",
                background: `rgba(34,197,94,${opacity.toFixed(3)})`,
                pointerEvents: "none",
              }}
            />
          </div>
        );
      })}
    </div>
  );
});
