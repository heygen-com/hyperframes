import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import {
  classifyPropertyGroup,
  type GsapAnimation,
  type PropertyGroupName,
} from "@hyperframes/core/gsap-parser";
import { toAbsoluteTime } from "../../hooks/gsapShared";
import { synthesizeFlatTweenKeyframes } from "../../hooks/gsapTweenSynth";
import { TimelineDiamondLane, type TimelineDiamondKeyframe } from "./TimelineClipDiamonds";
import { LANE_H, getTimelineLaneTop } from "./timelineLayout";
import type { TimelineKeyframeTarget } from "./timelineKeyframeIdentity";

export interface TimelinePropertyLanesProps {
  animations: readonly GsapAnimation[];
  clipStart: number;
  clipDuration: number;
  clipLeftPx: number;
  clipWidthPx: number;
  accentColor: string;
  isSelected: boolean;
  currentPercentage: number;
  elementId: string;
  selectedKeyframes: ReadonlySet<string>;
  onSelectSegment?: (target: TimelineKeyframeTarget) => void;
  onClickKeyframe?: (target: TimelineKeyframeTarget) => void;
  onShiftClickKeyframe?: (target: TimelineKeyframeTarget) => void;
  onContextMenuKeyframe?: (e: ReactMouseEvent, target: TimelineKeyframeTarget) => void;
  onMoveKeyframe?: (target: TimelineKeyframeTarget, toClipPercentage: number) => Promise<boolean>;
  suppressClickRef?: RefObject<boolean>;
}

function hasGroupProperty(
  properties: Record<string, number | string>,
  group: PropertyGroupName,
): boolean {
  return Object.keys(properties).some((property) => classifyPropertyGroup(property) === group);
}

/** The tween's editable keyframes: its real keyframes, or the start→end pair
 *  synthesized for a flat tween. Empty for a tween that animates nothing. */
function animationKeyframes(animation: GsapAnimation) {
  return animation.keyframes?.keyframes ?? synthesizeFlatTweenKeyframes(animation)?.keyframes ?? [];
}

/** A tween contributes a property lane when it has a group and at least one
 *  editable keyframe (real or synthesized). */
export function animationContributesLane(animation: GsapAnimation): boolean {
  return !!animation.propertyGroup && animationKeyframes(animation).length > 0;
}

function sourceGroups(animations: readonly GsapAnimation[]) {
  const groups = new Map<PropertyGroupName, GsapAnimation[]>();
  for (const animation of animations) {
    if (!animation.propertyGroup || !animationContributesLane(animation)) continue;
    const groupAnimations = groups.get(animation.propertyGroup) ?? [];
    groupAnimations.push(animation);
    groups.set(animation.propertyGroup, groupAnimations);
  }
  return groups;
}

function groupKeyframes(
  animations: readonly GsapAnimation[],
  group: PropertyGroupName,
  clipStart: number,
  clipDuration: number,
): TimelineDiamondKeyframe[] {
  const keyframes: TimelineDiamondKeyframe[] = [];
  for (const animation of animations) {
    const tweenStart =
      animation.resolvedStart ?? (typeof animation.position === "number" ? animation.position : 0);
    const tweenDuration = animation.duration ?? clipDuration;
    for (const keyframe of animationKeyframes(animation)) {
      if (!hasGroupProperty(keyframe.properties, group)) continue;
      const absoluteTime = toAbsoluteTime(tweenStart, tweenDuration, keyframe.percentage);
      keyframes.push({
        ...keyframe,
        percentage: ((absoluteTime - clipStart) / clipDuration) * 100,
        tweenPercentage: keyframe.percentage,
        propertyGroup: group,
        animationId: animation.id,
      });
    }
  }
  return keyframes;
}

export function getTimelinePropertyLanes(
  animations: readonly GsapAnimation[],
  clipStart: number,
  clipDuration: number,
) {
  if (clipDuration <= 0) return [];
  return Array.from(sourceGroups(animations), ([group, groupAnimations]) => ({
    group,
    animations: groupAnimations,
    keyframes: groupKeyframes(groupAnimations, group, clipStart, clipDuration),
  })).filter((lane) => lane.keyframes.length > 0);
}

export function TimelinePropertyLanes({
  animations,
  clipStart,
  clipDuration,
  clipLeftPx,
  clipWidthPx,
  accentColor,
  isSelected,
  currentPercentage,
  elementId,
  selectedKeyframes,
  onSelectSegment,
  onClickKeyframe,
  onShiftClickKeyframe,
  onContextMenuKeyframe,
  onMoveKeyframe,
  suppressClickRef,
}: TimelinePropertyLanesProps) {
  if (clipWidthPx < 20 || clipDuration <= 0) return null;
  const lanes = getTimelinePropertyLanes(animations, clipStart, clipDuration);

  if (lanes.length === 0) return null;
  return (
    <>
      {lanes.map(({ group, animations: groupAnimations, keyframes }, laneIndex) => (
        <div
          key={group}
          role="row"
          aria-level={2}
          aria-label={`${group} keyframes`}
          data-property-group={group}
          data-timeline-property-lane=""
          data-timeline-lane-top={getTimelineLaneTop(laneIndex)}
          className="absolute"
          style={{
            left: clipLeftPx,
            top: getTimelineLaneTop(laneIndex),
            width: clipWidthPx,
            height: LANE_H,
          }}
        >
          <TimelineDiamondLane
            keyframesData={{ format: "percentage", keyframes }}
            globalEase={
              groupAnimations[0]?.keyframes?.easeEach ?? groupAnimations[0]?.ease ?? "none"
            }
            clipWidthPx={clipWidthPx}
            clipHeightPx={LANE_H}
            accentColor={accentColor}
            isSelected={isSelected}
            currentPercentage={currentPercentage}
            elementId={elementId}
            selectedKeyframes={selectedKeyframes}
            onSelectSegment={onSelectSegment}
            onClickKeyframe={onClickKeyframe}
            onShiftClickKeyframe={onShiftClickKeyframe}
            onContextMenuKeyframe={onContextMenuKeyframe}
            onMoveKeyframe={onMoveKeyframe}
            suppressClickRef={suppressClickRef}
            groupAware
          />
        </div>
      ))}
    </>
  );
}
