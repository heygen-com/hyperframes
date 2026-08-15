import { useMemo } from "react";
import type { TimelineElement } from "../store/playerStore";
import { isCanaryEnabled } from "../../telemetry/canary";
import { getTrackStyle, type TrackVisualStyle } from "./timelineIcons";

/** One resolved audio group, positioned in the row order. */
export interface TimelineTrackGroupInfo {
  id: string;
  label: string;
  /**
   * Synthetic sort key for the group's own row — the same fractional-key
   * convention sub-composition expansion already uses (see
   * timelineTrackDisplay.ts): the first (lowest) member track's number minus
   * 0.5, so it slots in immediately above that member.
   */
  anchorKey: number;
  /** Member track numbers, ascending. */
  memberTracks: number[];
}

interface GroupMembership {
  trackToGroupId: Map<number, string>;
  memberTracksByGroup: Map<string, number[]>;
  labelByGroup: Map<string, string>;
}

/** Which track belongs to which group, and each group's label — one pass over raw tracks. */
function resolveGroupMembership(rawTracks: [number, TimelineElement[]][]): GroupMembership {
  const trackToGroupId = new Map<number, string>();
  const memberTracksByGroup = new Map<string, number[]>();
  const labelByGroup = new Map<string, string>();
  for (const [trackNum, elements] of rawTracks) {
    const owner = elements.find((el) => el.audioGroup);
    if (!owner?.audioGroup) continue;
    trackToGroupId.set(trackNum, owner.audioGroup);
    if (!labelByGroup.has(owner.audioGroup)) {
      labelByGroup.set(owner.audioGroup, owner.audioGroupLabel ?? owner.audioGroup);
    }
    const members = memberTracksByGroup.get(owner.audioGroup) ?? [];
    members.push(trackNum);
    memberTracksByGroup.set(owner.audioGroup, members);
  }
  return { trackToGroupId, memberTracksByGroup, labelByGroup };
}

/**
 * Pull each group's members out of raw ascending track order and re-emit them
 * contiguously, directly beneath a synthetic anchor row. Ungrouped tracks keep
 * their position; a group's members move up to sit under its anchor even when
 * other (ungrouped) tracks were interleaved between them.
 */
function groupTimelineTracks(rawTracks: [number, TimelineElement[]][]): {
  tracks: [number, TimelineElement[]][];
  groups: TimelineTrackGroupInfo[];
  trackGroupOf: Map<number, TimelineTrackGroupInfo>;
} {
  const { trackToGroupId, memberTracksByGroup, labelByGroup } = resolveGroupMembership(rawTracks);
  const rawByTrack = new Map(rawTracks);
  const groups: TimelineTrackGroupInfo[] = [];
  const trackGroupOf = new Map<number, TimelineTrackGroupInfo>();
  const emitted = new Set<string>();
  const tracks: [number, TimelineElement[]][] = [];

  for (const [trackNum, elements] of rawTracks) {
    const groupId = trackToGroupId.get(trackNum);
    if (!groupId) {
      tracks.push([trackNum, elements]);
      continue;
    }
    if (emitted.has(groupId)) continue;
    emitted.add(groupId);
    const memberTracks = [...(memberTracksByGroup.get(groupId) ?? [])].sort((a, b) => a - b);
    const info: TimelineTrackGroupInfo = {
      id: groupId,
      label: labelByGroup.get(groupId) ?? groupId,
      anchorKey: (memberTracks[0] ?? trackNum) - 0.5,
      memberTracks,
    };
    groups.push(info);
    tracks.push([info.anchorKey, []]);
    for (const member of memberTracks) {
      trackGroupOf.set(member, info);
      tracks.push([member, rawByTrack.get(member) ?? []]);
    }
  }
  return { tracks, groups, trackGroupOf };
}

/**
 * Per-render track derivations Timeline.tsx feeds the canvas/lanes: the lane →
 * clip grouping (`tracks`, group-aware order), per-lane visual styles, the
 * matching `trackOrder`, and audio-group membership. Extracted from
 * Timeline.tsx as a cohesive unit (600-line studio cap); each memo keys on the
 * expanded display element set exactly as before.
 */
export function useTimelineTrackDerivations(expandedElements: TimelineElement[]): {
  tracks: [number, TimelineElement[]][];
  trackStyles: Map<number, TrackVisualStyle>;
  trackOrder: number[];
  groups: TimelineTrackGroupInfo[];
  trackGroupOf: Map<number, TimelineTrackGroupInfo>;
} {
  const rawTracks = useMemo(() => {
    const map = new Map<number, TimelineElement[]>();
    for (const el of expandedElements) {
      const list = map.get(el.track) ?? [];
      list.push(el);
      map.set(el.track, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b);
  }, [expandedElements]);

  const { tracks, groups, trackGroupOf } = useMemo(() => {
    if (!isCanaryEnabled("audio-groups")) {
      return {
        tracks: rawTracks,
        groups: [],
        trackGroupOf: new Map<number, TimelineTrackGroupInfo>(),
      };
    }
    return groupTimelineTracks(rawTracks);
  }, [rawTracks]);

  const trackStyles = useMemo(() => {
    const map = new Map<number, TrackVisualStyle>();
    for (const [trackNum, els] of tracks) {
      map.set(trackNum, getTrackStyle(els[0]?.tag ?? ""));
    }
    return map;
  }, [tracks]);

  const trackOrder = useMemo(() => tracks.map(([trackNum]) => trackNum), [tracks]);

  return { tracks, trackStyles, trackOrder, groups, trackGroupOf };
}
