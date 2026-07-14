import { memo, useRef, useState } from "react";
import { moveBeatCompositionTime, deleteBeatAtCompositionTime } from "../../utils/beatEditActions";
import { usePlayerStore } from "../store/playerStore";
import { CLIP_Y } from "./timelineLayout";

export const BEAT_BAND_H = 14; // dark band height at top of track
const BEAT_HIT_W = 12; // grab width per beat (px)

/** Hide both layers when beats are packed tighter than this (px) — too dense to read. */
function beatsTooDense(beatTimes: number[], pps: number): boolean {
  if (beatTimes.length < 2) return true;
  const avgInterval = (beatTimes[beatTimes.length - 1]! - beatTimes[0]!) / (beatTimes.length - 1);
  return avgInterval * pps < 5;
}

/**
 * Faint full-height beat lines painted into a track lane's background. Rendered
 * behind the clips so they only show through the empty track area (the dots in
 * BeatStrip mark beats on the clips themselves). Brightness scales with beat
 * loudness. Drawn on every track lane for a global beat grid.
 */
export const BeatBackgroundLines = memo(function BeatBackgroundLines({
  beatTimes,
  beatStrengths,
  pps,
  highlightTime,
}: {
  beatTimes: number[] | undefined;
  beatStrengths: number[] | undefined;
  pps: number;
  /** Snap guide time — drawn as a bright line even when it is not a beat. */
  highlightTime?: number | null;
}) {
  const visibleBeatTimes = beatTimes && !beatsTooDense(beatTimes, pps) ? beatTimes : null;
  const highlightIsBeat =
    highlightTime != null &&
    visibleBeatTimes?.some((t) => Math.abs(t - highlightTime) < 1e-3) === true;
  if (!visibleBeatTimes && highlightTime == null) return null;
  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 0 }}>
      {visibleBeatTimes?.map((t, i) => {
        const isHighlight = highlightTime != null && Math.abs(t - highlightTime) < 1e-3;
        const strength = Math.pow(Math.min(1, beatStrengths?.[i] ?? 0.5), 2.2);
        const opacity = isHighlight ? 1 : 0.06 + strength * 0.16;
        return (
          <div
            key={`${t}-${i}`}
            className="absolute top-0 bottom-0"
            style={{
              left: t * pps,
              width: isHighlight ? 2 : 1,
              background: `rgba(34,197,94,${opacity.toFixed(3)})`,
              boxShadow: isHighlight ? "0 0 6px rgba(34,197,94,0.9)" : undefined,
              zIndex: isHighlight ? 1 : undefined,
            }}
          />
        );
      })}
      {highlightTime != null && !highlightIsBeat && (
        <div
          className="absolute top-0 bottom-0"
          style={{
            left: highlightTime * pps,
            width: 2,
            background: "rgba(34,197,94,1)",
            boxShadow: "0 0 6px rgba(34,197,94,0.9)",
            zIndex: 1,
          }}
        />
      )}
    </div>
  );
});

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

  if (!beatTimes || beatsTooDense(beatTimes, pps)) return null;
  const cy = BEAT_BAND_H / 2;

  return (
    <div
      className="absolute left-0 right-0 pointer-events-none"
      style={{ top: CLIP_Y, height: BEAT_BAND_H, background: "rgba(0,0,0,0.28)", zIndex: 11 }}
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
              usePlayerStore.getState().setBeatDragging(true); // hide the playhead guideline
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
              usePlayerStore.getState().setBeatDragging(false);
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
