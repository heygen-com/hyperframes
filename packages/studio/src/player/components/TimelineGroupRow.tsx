import { usePlayerStore } from "../store/playerStore";
import { isGroupHalfLitUnderSolo } from "../store/audioSoloSlice";
import { runtimeAudioId } from "../lib/timelineElementHelpers";
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
import { useTimelineEditContextOptional } from "../../contexts/TimelineEditContext";
import { useDomEditActionsContextOptional } from "../../contexts/DomEditContext";

interface TimelineGroupRowProps {
  index: number;
  rowKey: number;
  group: TimelineTrackGroupInfo;
  logicalRow: TimelineLogicalRow;
  top: number;
  height: number;
  virtualized: boolean;
  theme: TimelineTheme;
  rovingTargetId?: string | null;
  collapsedGroupIds: ReadonlySet<string>;
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
  top,
  height,
  virtualized,
  theme,
  rovingTargetId = null,
  collapsedGroupIds,
  expandedLaneOwnerIds,
  toggleGroupExpanded,
  toggleLaneOwnerExpanded,
}: TimelineGroupRowProps) {
  // From the group, NOT from `tracks`: a collapsed group emits no member rows
  // into the display list, and every one of these reads silently degraded to
  // empty in that (default) state — half-lit solo went dark, the lane count
  // read 0, and the bus strip fell back to "track 1", "track 2".
  const memberElements = group.memberElements;
  const memberLabels = group.memberTracks.map((track, i) => {
    const owner = memberElements.find((el) => el.track === track && el.audioGroup);
    return owner?.label ?? owner?.id ?? `track ${i + 1}`;
  });
  const isLaneOpen = expandedLaneOwnerIds.has(group.id);
  // Optional, like every sibling row: Timeline renders outside the edit
  // provider in read-only hosts (Timeline.test.ts asserts it), and the throwing
  // hook took the whole timeline down with it the moment a group existed —
  // not just this row.
  const { onSetAudioGroupAttributeLive, onSetAudioGroupAttributeQuiet } =
    useTimelineEditContextOptional();
  const domEditActions = useDomEditActionsContextOptional();
  const soloed = usePlayerStore((s) => s.soloed);
  const toggleSolo = usePlayerStore((s) => s.toggleSolo);
  // Bare DOM ids: this list is compared against the `soloed` set, which the
  // runtime matches on `el.id` (see `runtimeAudioId`). Store keys here made the
  // half-lit state unreachable — soloing a member lit nothing on its group.
  const memberIds = memberElements.map(runtimeAudioId).filter((id): id is string => id !== null);
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
        isExpanded={!collapsedGroupIds.has(group.id)}
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
        // Always the full label column, never squeezed down to `contentOrigin`.
        // A track row can afford a narrow gutter because its CLIPS carry the
        // name on the bar; a group row has no clips at all, so the gutter is
        // the only place its name exists — and at the default fit the gutter is
        // ~80px, which rendered the label at zero width and clipped the solo,
        // FX and lane buttons off the side. Overhanging into the lane area is
        // safe precisely because this row is empty (see `propertyRows={[]}`).
        columnWidth={LABEL_COL_W}
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
