import type { TimelineElement } from "../store/playerStore";
import type { TimelineTheme } from "./timelineTheme";
import type { TimelineTrackGroupInfo } from "./useTimelineTrackDerivations";
import type { TimelineLogicalRow } from "./timelineKeyboardNavigation";
import { TimelineTrackRow } from "./TimelineTrackRow";
import { TimelineGroupHeader } from "./TimelineGroupHeader";
import { groupAutomationLanes } from "./automationLaneData";
import { LABEL_COL_W } from "./timelineLayout";

interface TimelineGroupRowProps {
  index: number;
  rowKey: number;
  group: TimelineTrackGroupInfo;
  logicalRow: TimelineLogicalRow;
  tracks: readonly (readonly [number, readonly TimelineElement[]])[];
  top: number;
  height: number;
  virtualized: boolean;
  contentOrigin: number;
  theme: TimelineTheme;
  rovingTargetId?: string | null;
  expandedGroupIds: ReadonlySet<string>;
  expandedLaneOwnerIds: ReadonlySet<string>;
  toggleGroupExpanded: (id: string) => void;
  toggleLaneOwnerExpanded: (id: string) => void;
}

/** A group's own row: the accessible shell (shared with track rows) plus the group header. */
export function TimelineGroupRow({
  index,
  rowKey,
  group,
  logicalRow,
  tracks,
  top,
  height,
  virtualized,
  contentOrigin,
  theme,
  rovingTargetId = null,
  expandedGroupIds,
  expandedLaneOwnerIds,
  toggleGroupExpanded,
  toggleLaneOwnerExpanded,
}: TimelineGroupRowProps) {
  const memberElements = group.memberTracks.flatMap(
    (track) => tracks.find(([t]) => t === track)?.[1] ?? [],
  );
  return (
    <TimelineTrackRow
      index={index}
      rowKey={rowKey}
      logicalRow={logicalRow}
      propertyRows={[]}
      lanesId=""
      headerLanesId=""
      top={top}
      height={height}
      virtualized={virtualized}
      background={theme.rowBackground}
      borderColor={theme.rowBorder}
      rovingTargetId={rovingTargetId}
    >
      <TimelineGroupHeader
        label={group.label}
        memberCount={group.memberTracks.length}
        isExpanded={expandedGroupIds.has(group.id)}
        onToggleExpanded={() => toggleGroupExpanded(group.id)}
        laneCount={groupAutomationLanes(memberElements).length}
        isLaneOpen={expandedLaneOwnerIds.has(group.id)}
        onToggleLanes={() => toggleLaneOwnerExpanded(group.id)}
        columnWidth={contentOrigin >= LABEL_COL_W ? LABEL_COL_W : contentOrigin}
        theme={theme}
      />
    </TimelineTrackRow>
  );
}
