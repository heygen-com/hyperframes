import type { ReactNode } from "react";
import { timelineLogicalRowCellId } from "./timelineNavigationIdentity";
import type { TimelineLogicalRow } from "./timelineKeyboardNavigation";

interface TimelineTrackRowProps {
  index: number;
  rowKey: number;
  logicalRow: TimelineLogicalRow;
  propertyRows: readonly TimelineLogicalRow[];
  top: number;
  height: number;
  virtualized: boolean;
  background: string;
  borderColor: string;
  rovingTargetId?: string | null;
  children: ReactNode;
}

/** Accessible row shell; edit geometry owns its exact top and height. */
export function TimelineTrackRow({
  index,
  rowKey,
  logicalRow,
  propertyRows,
  top,
  height,
  virtualized,
  background,
  borderColor,
  rovingTargetId = null,
  children,
}: TimelineTrackRowProps) {
  return (
    <div
      role="rowgroup"
      data-index={index}
      data-timeline-row={index}
      data-timeline-row-key={rowKey}
      className={virtualized ? "absolute left-0 right-0" : "relative"}
      style={{
        top: virtualized ? top : undefined,
        height,
        background,
        borderBottom: `1px solid ${borderColor}`,
      }}
    >
      <div
        role="row"
        aria-rowindex={logicalRow.logicalIndex + 1}
        aria-level={logicalRow.level}
        aria-expanded={logicalRow.expandable ? logicalRow.expanded : undefined}
        data-timeline-logical-row-id={logicalRow.id}
        data-timeline-focus-id={logicalRow.id}
        tabIndex={rovingTargetId === logicalRow.id ? 0 : -1}
        className="flex"
        style={{ height }}
      >
        {children}
      </div>
      {propertyRows.map((row) => {
        const group = row.propertyGroup;
        const keyframeCount = row.items.filter((item) => item.kind === "keyframe").length;
        const easeCount = row.items.filter((item) => item.kind === "ease").length;
        return (
          <div
            key={row.id}
            role="row"
            aria-rowindex={row.logicalIndex + 1}
            aria-level={row.level}
            data-property-group={group}
            data-timeline-logical-row-id={row.id}
            className="sr-only"
          >
            <div role="rowheader" aria-owns={timelineLogicalRowCellId(row.id, "header")}>
              {group}
            </div>
            <div role="gridcell" aria-owns={timelineLogicalRowCellId(row.id, "content")}>
              {keyframeCount} keyframes, {easeCount} ease controls
            </div>
          </div>
        );
      })}
    </div>
  );
}
