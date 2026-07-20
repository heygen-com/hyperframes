import { useState } from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import {
  classifyPropertyGroup,
  type GsapAnimation,
  type PropertyGroupName,
} from "@hyperframes/core/gsap-parser";
import {
  clipToTweenPercentage,
  getKeyframeNavigationState,
} from "../../components/editor/KeyframeNavigation";
import { Music } from "../../icons/SystemIcons";
import {
  absoluteToPercentageForAnimation,
  isTimeWithinTween,
  resolveTweenDuration,
  resolveTweenStart,
} from "../../utils/globalTimeCompiler";
import type { TimelineElement } from "../store/playerStore";
import type {
  TimelineEditCallbacks,
  TimelinePropertyGroupKeyframeToggle,
} from "./timelineCallbacks";
import { getTimelinePropertyLanes } from "./TimelinePropertyLanes";
import { LayerDisclosureRow } from "./LayerDisclosureRow";
import { LABEL_COL_W, LANE_H, getTimelineLaneTop } from "./timelineLayout";
import type { TimelineTheme } from "./timelineTheme";
import { timelineLogicalRowCellId, timelinePropertyRowId } from "./timelineNavigationIdentity";

interface TimelineTrackHeaderProps {
  trackNumber: number;
  trackLabel: string;
  contentOrigin: number;
  /** The track's active keyframe clip (selected, else primary) — the one whose
   *  disclosure + property rows this header shows, whether expanded or not. */
  keyframeClip: TimelineElement | null;
  isExpanded: boolean;
  animations: readonly GsapAnimation[];
  currentTime: number;
  isTrackHidden: boolean;
  isAudioTrack: boolean;
  isActive: boolean;
  isHovered: boolean;
  theme: TimelineTheme;
  onToggleClipExpanded: () => void;
  onToggleTrackHidden: TimelineEditCallbacks["onToggleTrackHidden"];
  onTogglePropertyGroupKeyframe?: TimelineEditCallbacks["onTogglePropertyGroupKeyframe"];
  onSeek?: (time: number) => void;
}

function roundValue(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function propertyValueAt(
  animation: GsapAnimation,
  property: string,
  tweenPercentage: number,
): number | string | undefined {
  const keyframes = animation.keyframes?.keyframes ?? [];
  const values = keyframes
    .filter((keyframe) => property in keyframe.properties)
    .map((keyframe) => ({
      percentage: keyframe.percentage,
      value: keyframe.properties[property],
    }));
  const before = values.filter((value) => value.percentage <= tweenPercentage).at(-1);
  const after = values.find((value) => value.percentage >= tweenPercentage);
  if (!before) return after?.value;
  if (!after) return before.value;
  if (
    typeof before.value !== "number" ||
    typeof after.value !== "number" ||
    before.percentage === after.percentage
  ) {
    return before.value;
  }
  const progress = (tweenPercentage - before.percentage) / (after.percentage - before.percentage);
  return before.value + (after.value - before.value) * progress;
}

function valuesAt(
  animation: GsapAnimation,
  group: PropertyGroupName,
  tweenPercentage: number,
): Record<string, number | string> {
  const propertyNames = new Set<string>();
  for (const keyframe of animation.keyframes?.keyframes ?? []) {
    for (const property of Object.keys(keyframe.properties)) {
      if (classifyPropertyGroup(property) === group) propertyNames.add(property);
    }
  }
  const values: Record<string, number | string> = {};
  for (const property of propertyNames) {
    const value = propertyValueAt(animation, property, tweenPercentage);
    if (value !== undefined) values[property] = value;
  }
  return values;
}

function groupLabel(group: PropertyGroupName, properties: Record<string, number | string>): string {
  if (group === "visual" && ("opacity" in properties || "autoAlpha" in properties)) {
    return "Opacity";
  }
  if (group !== "other") return `${group[0]?.toUpperCase() ?? ""}${group.slice(1)}`;
  const property = Object.keys(properties)[0];
  return property ? `${property[0]?.toUpperCase() ?? ""}${property.slice(1)}` : "Other";
}

type LaneValues = Record<string, number | string>;

function defaultValueReadout(values: LaneValues): string {
  return Object.values(values)
    .map((value) => (typeof value === "number" ? roundValue(value) : value))
    .join(", ");
}

function positionValueReadout(values: LaneValues): string | null {
  const x = values.x;
  const y = values.y;
  return typeof x === "number" && typeof y === "number"
    ? `${roundValue(x)}, ${roundValue(y)}`
    : null;
}

function rotationValueReadout(values: LaneValues): string | null {
  return typeof values.rotation === "number" ? `${roundValue(values.rotation)}°` : null;
}

function visualValueReadout(values: LaneValues): string | null {
  const opacity = values.opacity ?? values.autoAlpha;
  return typeof opacity === "number"
    ? `${roundValue(Math.abs(opacity) <= 1 ? opacity * 100 : opacity)}%`
    : null;
}

const GROUP_VALUE_READOUTS: Partial<
  Record<PropertyGroupName, (values: LaneValues) => string | null>
> = {
  position: positionValueReadout,
  rotation: rotationValueReadout,
  visual: visualValueReadout,
};

function valueReadout(group: PropertyGroupName, values: Record<string, number | string>): string {
  return GROUP_VALUE_READOUTS[group]?.(values) ?? defaultValueReadout(values);
}

function VisibilityButton({
  hidden,
  trackNumber,
  visible,
  onToggle,
}: {
  hidden: boolean;
  trackNumber: number;
  visible: boolean;
  onToggle: TimelineEditCallbacks["onToggleTrackHidden"];
}) {
  if (!visible) return <span aria-hidden="true" className="h-6 w-6 shrink-0" />;
  const label = hidden ? `Show track ${trackNumber}` : `Hide track ${trackNumber}`;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border-0 bg-transparent p-0 transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-[#3CE6AC] ${
        hidden ? "text-[#3CE6AC] hover:text-white" : "text-white/35 hover:text-white/75"
      }`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        void onToggle?.(trackNumber, !hidden);
      }}
    >
      {hidden ? (
        <EyeSlash size={14} weight="bold" aria-hidden="true" />
      ) : (
        <Eye size={14} weight="bold" aria-hidden="true" />
      )}
    </button>
  );
}

function LegacyTrackHeader({
  trackNumber,
  trackLabel,
  showTrackLabel,
  isTrackHidden,
  isAudioTrack,
  onToggleTrackHidden,
}: Pick<
  TimelineTrackHeaderProps,
  "trackNumber" | "trackLabel" | "isTrackHidden" | "isAudioTrack" | "onToggleTrackHidden"
> & { showTrackLabel: boolean }) {
  return (
    <>
      {isAudioTrack && (
        <Music size={12} weight="fill" aria-hidden="true" className="text-white/35" />
      )}
      {showTrackLabel && <span className="min-w-0 flex-1 truncate text-[11px]">{trackLabel}</span>}
      <VisibilityButton
        hidden={isTrackHidden}
        trackNumber={trackNumber}
        visible
        onToggle={onToggleTrackHidden}
      />
    </>
  );
}

type TimelinePropertyLane = ReturnType<typeof getTimelinePropertyLanes>[number];
type KeyframeNavigationState = ReturnType<
  typeof getKeyframeNavigationState<TimelinePropertyLane["keyframes"][number]>
>;

function findNearestLaneKeyframe(lane: TimelinePropertyLane, clipPercentage: number) {
  return lane.keyframes.reduce<(typeof lane.keyframes)[number] | null>(
    (nearest, keyframe) =>
      !nearest ||
      Math.abs(keyframe.percentage - clipPercentage) < Math.abs(nearest.percentage - clipPercentage)
        ? keyframe
        : nearest,
    null,
  );
}

function findAnimationAtTime(animations: TimelinePropertyLane["animations"], currentTime: number) {
  return animations.find((candidate) => {
    const start = resolveTweenStart(candidate);
    return start !== null && isTimeWithinTween(currentTime, start, resolveTweenDuration(candidate));
  });
}

function resolveLaneAnimation(
  lane: TimelinePropertyLane,
  navigation: KeyframeNavigationState,
  nearestKeyframe: TimelinePropertyLane["keyframes"][number] | null,
  animationAtPlayhead: GsapAnimation | undefined,
) {
  const animationId = navigation.currentKeyframe?.animationId ?? nearestKeyframe?.animationId;
  return animationAtPlayhead ?? lane.animations.find((candidate) => candidate.id === animationId);
}

function resolveLaneTweenPercentage(
  navigation: KeyframeNavigationState,
  animation: GsapAnimation | undefined,
  animationKeyframes: TimelinePropertyLane["keyframes"],
  currentTime: number,
  clipPercentage: number,
) {
  return (
    navigation.currentKeyframe?.tweenPercentage ??
    (animation ? absoluteToPercentageForAnimation(currentTime, animation) : null) ??
    clipToTweenPercentage(animationKeyframes, clipPercentage)
  );
}

function valuesForLaneAnimation(
  animation: GsapAnimation | undefined,
  lane: TimelinePropertyLane,
  tweenPercentage: number,
) {
  return animation ? valuesAt(animation, lane.group, tweenPercentage) : {};
}

function createLaneToggleTarget(
  animation: GsapAnimation | undefined,
  lane: TimelinePropertyLane,
  tweenPercentage: number,
  values: LaneValues,
  navigation: KeyframeNavigationState,
): TimelinePropertyGroupKeyframeToggle | null {
  return animation
    ? {
        animationId: animation.id,
        propertyGroup: lane.group,
        tweenPercentage,
        properties: values,
        remove: navigation.currentKeyframe !== null,
      }
    : null;
}

function resolveLaneHeaderState(
  lane: TimelinePropertyLane,
  currentTime: number,
  clipPercentage: number,
) {
  const navigation = getKeyframeNavigationState(lane.keyframes, clipPercentage);
  const nearestKeyframe = findNearestLaneKeyframe(lane, clipPercentage);
  const animationAtPlayhead = findAnimationAtTime(lane.animations, currentTime);
  const animation = resolveLaneAnimation(lane, navigation, nearestKeyframe, animationAtPlayhead);
  const animationKeyframes = lane.keyframes.filter(
    (keyframe) => keyframe.animationId === animation?.id,
  );
  const tweenPercentage = resolveLaneTweenPercentage(
    navigation,
    animation,
    animationKeyframes,
    currentTime,
    clipPercentage,
  );
  const values = valuesForLaneAnimation(animation, lane, tweenPercentage);
  const label = groupLabel(lane.group, values);
  const toggleTarget = createLaneToggleTarget(animation, lane, tweenPercentage, values, navigation);

  return {
    navigation,
    nearestKeyframe,
    animationAtPlayhead,
    animation,
    animationKeyframes,
    tweenPercentage,
    values,
    label,
    toggleTarget,
  };
}

// Figma layout: prev-keyframe ‹, the add/remove toggle (children), next ›.
function PropertyGroupNavigation({
  navigation,
  label,
  expandedElement,
  onSeek,
  children,
}: {
  navigation: KeyframeNavigationState;
  label: string;
  expandedElement: TimelineElement;
  onSeek?: (time: number) => void;
  children: React.ReactNode;
}) {
  const seekTo = (keyframe: { percentage: number } | null) => {
    if (keyframe) {
      onSeek?.(expandedElement.start + (keyframe.percentage / 100) * expandedElement.duration);
    }
  };
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        aria-label={`Previous ${label} keyframe`}
        disabled={!navigation.prevKeyframe}
        className="h-5 w-3 border-0 bg-transparent p-0 text-white/55 hover:text-white disabled:text-white/15"
        onClick={() => seekTo(navigation.prevKeyframe)}
      >
        ‹
      </button>
      {children}
      <button
        type="button"
        aria-label={`Next ${label} keyframe`}
        disabled={!navigation.nextKeyframe}
        className="h-5 w-3 border-0 bg-transparent p-0 text-white/55 hover:text-white disabled:text-white/15"
        onClick={() => seekTo(navigation.nextKeyframe)}
      >
        ›
      </button>
    </span>
  );
}

function PropertyGroupHeaderRow({
  lane,
  laneIndex,
  isLastLane,
  expandedElement,
  currentTime,
  clipPercentage,
  hoveredGroup,
  setHoveredGroup,
  isActive,
  isHovered,
  isTrackHidden,
  trackNumber,
  gutterBackground,
  onToggleTrackHidden,
  onTogglePropertyGroupKeyframe,
  onSeek,
}: {
  lane: TimelinePropertyLane;
  laneIndex: number;
  isLastLane: boolean;
  expandedElement: TimelineElement;
  currentTime: number;
  clipPercentage: number;
  hoveredGroup: PropertyGroupName | null;
  setHoveredGroup: (group: PropertyGroupName | null) => void;
  isActive: boolean;
  isHovered: boolean;
  isTrackHidden: boolean;
  trackNumber: number;
  gutterBackground: string;
  onToggleTrackHidden: TimelineEditCallbacks["onToggleTrackHidden"];
  onTogglePropertyGroupKeyframe?: TimelineEditCallbacks["onTogglePropertyGroupKeyframe"];
  onSeek?: (time: number) => void;
}) {
  const elementId = expandedElement.key ?? expandedElement.id;
  const { navigation, values, label, toggleTarget } = resolveLaneHeaderState(
    lane,
    currentTime,
    clipPercentage,
  );
  const showEye =
    hoveredGroup === lane.group ||
    (hoveredGroup === null && laneIndex === 0 && (isActive || isHovered));

  return (
    <div
      id={timelineLogicalRowCellId(timelinePropertyRowId(elementId, lane.group), "header")}
      data-timeline-focus-id={timelinePropertyRowId(elementId, lane.group)}
      data-timeline-element-id={elementId}
      tabIndex={-1}
      data-property-group={lane.group}
      data-timeline-lane-top={getTimelineLaneTop(laneIndex)}
      className="absolute left-0 flex items-center gap-1 px-1.5 text-[10px] text-white/65"
      style={{
        top: getTimelineLaneTop(laneIndex),
        width: LABEL_COL_W,
        height: LANE_H,
        background: gutterBackground,
      }}
      onPointerEnter={() => setHoveredGroup(lane.group)}
      onPointerLeave={() => setHoveredGroup(null)}
    >
      {/* Tree connector: vertical spine (top-half on the last lane) + branch tick. */}
      <span className="relative h-full w-3 shrink-0" aria-hidden="true">
        <span
          className="absolute left-1.5 top-0 w-px bg-white/15"
          style={{ height: isLastLane ? "50%" : "100%" }}
        />
        <span className="absolute left-1.5 top-1/2 h-px w-1.5 bg-white/15" />
      </span>
      <span className="w-[46px] shrink-0 truncate text-white">{label}</span>
      <PropertyGroupNavigation
        navigation={navigation}
        label={label}
        expandedElement={expandedElement}
        onSeek={onSeek}
      >
        <button
          type="button"
          aria-label={`Toggle ${label} keyframe`}
          title={`${navigation.currentKeyframe ? "Remove" : "Add"} ${label} keyframe`}
          className="flex h-5 w-4 shrink-0 items-center justify-center border-0 bg-transparent p-0 text-[11px] text-[#3CE6AC] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#3CE6AC]"
          onClick={() => {
            if (expandedElement && toggleTarget) {
              void onTogglePropertyGroupKeyframe?.(expandedElement, toggleTarget);
            }
          }}
        >
          {navigation.currentKeyframe ? "◆" : "◇"}
        </button>
      </PropertyGroupNavigation>
      <span className="min-w-0 flex-1 truncate text-right tabular-nums text-white/45">
        {valueReadout(lane.group, values)}
      </span>
      <VisibilityButton
        hidden={isTrackHidden}
        trackNumber={trackNumber}
        visible={showEye}
        onToggle={onToggleTrackHidden}
      />
    </div>
  );
}

export function TimelineTrackHeader({
  trackNumber,
  trackLabel,
  contentOrigin,
  keyframeClip,
  isExpanded,
  animations,
  currentTime,
  isTrackHidden,
  isAudioTrack,
  isActive,
  isHovered,
  theme,
  onToggleClipExpanded,
  onToggleTrackHidden,
  onTogglePropertyGroupKeyframe,
  onSeek,
}: TimelineTrackHeaderProps) {
  const [hoveredGroup, setHoveredGroup] = useState<PropertyGroupName | null>(null);
  const clipPercentage = keyframeClip
    ? ((currentTime - keyframeClip.start) / keyframeClip.duration) * 100
    : 0;
  const lanes = keyframeClip
    ? getTimelinePropertyLanes(animations, keyframeClip.start, keyframeClip.duration)
    : [];
  // Label mode = keyframe view; the label column stays LABEL_COL_W (Timeline.tsx
  // owns the gutter past it, so a 0% diamond isn't clipped by this panel).
  const showTrackLabel = contentOrigin >= LABEL_COL_W;
  const isKeyframeLayer = !!keyframeClip && lanes.length > 0;

  return (
    <div
      role="rowheader"
      className={`sticky left-0 z-[12] shrink-0 ${
        !isKeyframeLayer
          ? showTrackLabel
            ? "flex items-center gap-1 px-1.5 text-white/55"
            : "flex flex-col items-center justify-center gap-0.5"
          : ""
      }`}
      style={{
        width: showTrackLabel ? LABEL_COL_W : contentOrigin,
        background: theme.gutterBackground,
        borderRight: `1px solid ${theme.gutterBorder}`,
      }}
    >
      {!keyframeClip || lanes.length === 0 ? (
        <LegacyTrackHeader
          trackNumber={trackNumber}
          trackLabel={trackLabel}
          showTrackLabel={showTrackLabel}
          isTrackHidden={isTrackHidden}
          isAudioTrack={isAudioTrack}
          onToggleTrackHidden={onToggleTrackHidden}
        />
      ) : (
        <>
          <LayerDisclosureRow
            keyframeClip={keyframeClip}
            isExpanded={isExpanded}
            gutterBackground={theme.gutterBackground}
            onToggleClipExpanded={onToggleClipExpanded}
          />
          {isExpanded &&
            lanes.map((lane, laneIndex) => (
              <PropertyGroupHeaderRow
                key={lane.group}
                lane={lane}
                laneIndex={laneIndex}
                isLastLane={laneIndex === lanes.length - 1}
                expandedElement={keyframeClip}
                currentTime={currentTime}
                clipPercentage={clipPercentage}
                hoveredGroup={hoveredGroup}
                setHoveredGroup={setHoveredGroup}
                isActive={isActive}
                isHovered={isHovered}
                isTrackHidden={isTrackHidden}
                trackNumber={trackNumber}
                gutterBackground={theme.gutterBackground}
                onToggleTrackHidden={onToggleTrackHidden}
                onTogglePropertyGroupKeyframe={onTogglePropertyGroupKeyframe}
                onSeek={onSeek}
              />
            ))}
        </>
      )}
    </div>
  );
}
