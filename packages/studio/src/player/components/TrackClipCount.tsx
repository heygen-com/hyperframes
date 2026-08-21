/**
 * How many clips the track holds, shown next to the track's identity so a
 * multi-clip track reads as one at a glance. A single-clip track shows nothing:
 * the clip bar already says "one", and the header stays low-density.
 */
export function TrackClipCount({ clipCount }: { clipCount: number }) {
  if (clipCount < 2) return null;
  return (
    <span
      aria-label={`${clipCount} clips`}
      title={`${clipCount} clips`}
      className="shrink-0 rounded-full bg-white/10 px-1 text-[9px] leading-[14px] tabular-nums text-white/55"
    >
      {clipCount}
    </span>
  );
}
