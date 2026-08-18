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
  contentOrigin: number;
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
  contentOrigin,
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
  // Hovering a preset on a muted bus is a question about the preset, not about
  // the mute — so the audition lifts the mute while it plays and puts it back
  // on the way out, the same borrow-and-return it already does with the
  // playhead. Live only: `data-hidden` stays in the document, so the row keeps
  // reading (and rendering) as muted throughout.
  const setGroupMutedLive = (muted: boolean) =>
    onSetAudioGroupAttributeLive?.(group.id, "data-hidden", muted ? "" : null);
  // Solo is not ours to borrow the same way — it is a statement about every
  // other track, and lifting it would silence the one the author soloed. Say so
  // instead, or the shelf auditions into silence and reads as broken.
  const silencedBySolo =
    soloed.size > 0 && !soloed.has(group.id) && !memberIds.some((id) => soloed.has(id));
  const silentReason = silencedBySolo ? "Another track is soloed — presets here are silent." : null;
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
        auditionSpans={memberElements}
        silentReason={silentReason}
        onSetMutedLive={setGroupMutedLive}
        onOpenFxRack={openGroupFxRack}
        // Same width as every other row's header. The group row needs a real
        // label column, but it gets one by turning `labelMode` on for the whole
        // timeline (see Timeline.tsx) rather than by overhanging alone — an
        // overhanging header paints opaquely across the rest of its row and
        // stays pinned there through horizontal scroll.
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
