import type { ReactNode } from "react";

interface TimelineTrackRowProps {
  index: number;
  rowKey: number;
  rowCount: number;
  top: number;
  height: number;
  virtualized: boolean;
  background: string;
  borderColor: string;
  children: ReactNode;
}

/** Accessible row shell; edit geometry owns its exact top and height. */
export function TimelineTrackRow({
  index,
  rowKey,
  rowCount,
  top,
  height,
  virtualized,
  background,
  borderColor,
  children,
}: TimelineTrackRowProps) {
  return (
    <div
      role="listitem"
      aria-posinset={index + 1}
      aria-setsize={rowCount}
      data-index={index}
      data-timeline-row={index}
      data-timeline-row-key={rowKey}
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
