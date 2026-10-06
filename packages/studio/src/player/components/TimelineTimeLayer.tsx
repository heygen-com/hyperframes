import type { ReactNode } from "react";

/**
 * A box one second wide at the current zoom. What sits in it places itself in percent of it
 * (`left: start * 100%`), so a zoom step rewrites this one width and no clip's style changes.
 */
export function TimelineTimeLayer({
  pixelsPerSecond,
  children,
}: {
  pixelsPerSecond: number;
  children: ReactNode;
}) {
  return (
    <div
      data-timeline-time-layer=""
      className="absolute inset-y-0 left-0"
      style={{ width: pixelsPerSecond }}
    >
      {children}
    </div>
  );
}

/** A time, in seconds, as a position inside a TimelineTimeLayer. */
export const timeLayerPercent = (seconds: number) => `${seconds * 100}%`;
