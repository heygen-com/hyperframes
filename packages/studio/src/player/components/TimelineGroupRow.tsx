import type { TimelineElement } from "../store/playerStore";
import { usePlayerStore } from "../store/playerStore";
import { isGroupHalfLitUnderSolo } from "../store/audioSoloSlice";
import {
  HF_AUDIO_FX_ATTR,
  serializeAudioFxChain,
  type HfAudioFxChain,
} from "@hyperframes/core/audio-fx";
import type { TimelineTheme } from "./timelineTheme";
import type { TimelineTrackGroupInfo } from "./useTimelineTrackDerivations";
import type { TimelineLogicalRow } from "./timelineKeyboardNavigation";
import { TimelineTrackRow } from "./TimelineTrackRow";
import { TimelineGroupHeader } from "./TimelineGroupHeader";
import { TimelineGroupBusStrip } from "./TimelineGroupBusStrip";
import { groupAutomationLanes } from "./automationLaneData";
import { LABEL_COL_W } from "./timelineLayout";
import { useTimelineEditContext } from "../../contexts/TimelineEditContext";
import { useDomEditActionsContextOptional } from "../../contexts/DomEditContext";

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
  const memberLabels = group.memberTracks.map((track, i) => {
    const owner = tracks.find(([t]) => t === track)?.[1]?.find((el) => el.audioGroup);
    return owner?.label ?? owner?.id ?? `track ${i + 1}`;
  });
  const isLaneOpen = expandedLaneOwnerIds.has(group.id);
  const { onSetAudioGroupAttributeLive, onSetAudioGroupAttributeQuiet } = useTimelineEditContext();
  const domEditActions = useDomEditActionsContextOptional();
  const soloed = usePlayerStore((s) => s.soloed);
  const toggleSolo = usePlayerStore((s) => s.toggleSolo);
  const memberIds = memberElements.map((el) => el.key ?? el.id);
  const writeGroupFxChain = (next: HfAudioFxChain, live: boolean) => {
    const value = next.nodes.length ? serializeAudioFxChain(next) : null;
    if (live) onSetAudioGroupAttributeLive?.(group.id, HF_AUDIO_FX_ATTR, value);
    else void onSetAudioGroupAttributeQuiet?.(group.id, HF_AUDIO_FX_ATTR, value, "Apply preset");
  };
  const openGroupFxRack = () => {
    const target = domEditActions?.previewIframeRef.current?.contentDocument?.getElementById(
      group.id,
    );
    if (!target) return;
    void domEditActions
      ?.buildDomSelectionFromTarget(target)
      .then((selection) => selection && domEditActions.applyDomSelection(selection));
  };
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
        isLaneOpen={isLaneOpen}
        onToggleLanes={() => toggleLaneOwnerExpanded(group.id)}
        hidden={group.hidden}
        onToggleHidden={() =>
          onSetAudioGroupAttributeQuiet?.(
            group.id,
            "data-hidden",
            group.hidden ? null : "",
            group.hidden ? "Unmute group" : `Mute group ${group.label}`,
          )
        }
        isSoloed={soloed.has(group.id)}
        isHalfLitSolo={isGroupHalfLitUnderSolo(soloed, group.id, memberIds)}
        onToggleSolo={(options) => toggleSolo(group.id, options)}
        fxChain={group.fxChain}
        onFxChainChange={(next) => writeGroupFxChain(next, false)}
        onFxChainPreview={(next) => writeGroupFxChain(next, true)}
        onOpenFxRack={openGroupFxRack}
        columnWidth={contentOrigin >= LABEL_COL_W ? LABEL_COL_W : contentOrigin}
        theme={theme}
      />
      {isLaneOpen && (
        <TimelineGroupBusStrip
          groupId={group.id}
          volume={group.volume}
          memberLabels={memberLabels}
          onVolumeChange={(value) =>
            onSetAudioGroupAttributeLive?.(group.id, "data-volume", String(value))
          }
          onVolumeCommit={(value) =>
            onSetAudioGroupAttributeQuiet?.(
              group.id,
              "data-volume",
              String(value),
              "Set group volume",
            )
          }
          theme={theme}
        />
      )}
    </TimelineTrackRow>
  );
}
