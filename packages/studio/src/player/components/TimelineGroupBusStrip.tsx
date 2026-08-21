/**
 * B7: the group's own volume slider + a living level bar + "Holds …" — the
 * bus, not the mechanism. No dB numbers, no peak-hold readout, no routing
 * row (groups doc §5, casual-user section) — a slider, a bar that moves with
 * the sound, and the words "Too loud" when it clips.
 */
import { useEffect, useRef, useState } from "react";
import { useGroupLevel } from "../../hooks/useGroupLevel";
import { STRIP_H, TRACK_H } from "./timelineLayout";
import type { TimelineTheme } from "./timelineTheme";

/** How long "Too loud" stays lit after the last clipped block. */
const CLIP_HOLD_MS = 2000;

function clampVolume(value: number): number {
  return Math.min(2, Math.max(0, value));
}

interface TimelineGroupBusStripProps {
  groupId: string;
  volume: number;
  memberLabels: readonly string[];
  onVolumeChange: (value: number) => void;
  onVolumeCommit: (value: number) => void;
  theme: TimelineTheme;
}

export function TimelineGroupBusStrip({
  groupId,
  volume,
  memberLabels,
  onVolumeChange,
  onVolumeCommit,
  theme,
}: TimelineGroupBusStripProps) {
  const [dragValue, setDragValue] = useState<number | null>(null);
  const reading = useGroupLevel(groupId);
  const [clipped, setClipped] = useState(false);
  const clipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!reading?.clipped) return;
    setClipped(true);
    if (clipTimerRef.current) clearTimeout(clipTimerRef.current);
    clipTimerRef.current = setTimeout(() => setClipped(false), CLIP_HOLD_MS);
  }, [reading?.clipped]);

  useEffect(
    () => () => {
      if (clipTimerRef.current) clearTimeout(clipTimerRef.current);
    },
    [],
  );

  const shownVolume = dragValue ?? volume;
  const level = Math.min(1, reading?.level ?? 0);
  const holdsText =
    memberLabels.length > 0 ? `Holds ${memberLabels.join(", ")}` : "Holds nothing yet";

  return (
    <div
      className="absolute left-0 right-0 flex items-center gap-2 px-2 text-[10px] text-white/70"
      style={{ top: TRACK_H, height: STRIP_H }}
    >
      <input
        type="range"
        aria-label="Group volume"
        min={0}
        max={2}
        step={0.01}
        value={shownVolume}
        className="h-1 w-20 shrink-0 accent-[#3CE6AC]"
        onChange={(event) => {
          const next = clampVolume(Number(event.currentTarget.value));
          setDragValue(next);
          onVolumeChange(next);
        }}
        onPointerUp={(event) => {
          const next = clampVolume(Number(event.currentTarget.value));
          setDragValue(null);
          onVolumeCommit(next);
        }}
      />
      <div
        className="relative h-1.5 w-16 shrink-0 overflow-hidden rounded-full"
        style={{ background: theme.gutterBorder }}
        aria-hidden="true"
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${level * 100}%`,
            background: clipped ? "#ff5c5c" : "#3CE6AC",
          }}
        />
      </div>
      {clipped && <span className="shrink-0 font-medium text-[#ff5c5c]">Too loud</span>}
      <span className="min-w-0 flex-1 truncate" title={holdsText}>
        {holdsText}
      </span>
    </div>
  );
}
