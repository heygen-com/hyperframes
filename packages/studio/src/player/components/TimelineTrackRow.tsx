import type { ReactNode } from "react";

interface TimelineTrackRowProps {
  index: number;
  top: number;
  height: number;
  virtualized: boolean;
  expanded?: boolean;
  background: string;
  borderColor: string;
  children: ReactNode;
}

/** Accessible row shell; edit geometry owns its exact top and height. */
export function TimelineTrackRow({
  index,
  top,
  height,
  virtualized,
  expanded,
  background,
  borderColor,
  children,
}: TimelineTrackRowProps) {
  return (
    <div
      role="row"
      aria-rowindex={index + 1}
      aria-level={1}
      aria-expanded={expanded}
      data-index={index}
      data-timeline-row={index}
      className={`${virtualized ? "absolute left-0 right-0" : "relative"} flex`}
      style={{
        top: virtualized ? top : undefined,
        height,
        background,
        borderBottom: `1px solid ${borderColor}`,
      }}
    >
      {children}
    </div>
  );
}
