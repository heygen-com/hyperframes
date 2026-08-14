import { Eye, EyeSlash } from "@phosphor-icons/react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { Music } from "../../icons/SystemIcons";
import type { TimelineElement } from "../store/playerStore";
import type { TimelineEditCallbacks } from "./timelineCallbacks";
import { getTimelinePropertyLanes } from "./TimelinePropertyLanes";
import { groupAutomationLanes } from "./automationLaneData";
import { AUTOMATION_LANE_H } from "./automationLaneHeight";
import { clipTimingStart } from "../../hooks/gsapShared";
import { LayerDisclosureRow } from "./LayerDisclosureRow";
import { TrackClipCount } from "./TrackClipCount";
import { LABEL_COL_W, LANE_H, getTimelineLaneTop } from "./timelineLayout";
import type { TimelineTheme } from "./timelineTheme";
import {
  resolveLaneHeaderState,
  type KeyframeNavigationState,
  type TimelinePropertyLane,
} from "./trackHeaderLaneState";
import { valueReadout } from "./trackHeaderLaneValues";
import { trackDisplaySuffix } from "./timelineTrackDisplay";
import { timelineLogicalRowCellId, timelinePropertyRowId } from "./timelineNavigationIdentity";

interface TimelineTrackHeaderProps {
  /** The track's real key: a FRACTIONAL z-order sort value. Routes callbacks;
   *  never shown or announced. */
  trackNumber: number;
  /** The track's 1-based position in the rendered order: the only number safe
   *  to put in a label. Announcing `trackNumber` read out "track
   *  0.16666666666666666". Null when the key has no row, which drops the number
   *  from the label rather than inventing one (see trackDisplayNumber). */
  trackDisplayNumber: number | null;
  trackLabel: string;
  /** Ids of the canvas-side lane regions the disclosure caret expands, space
   *  separated as `aria-controls` takes them: the active clip's keyframe lanes
   *  and the track's automation lanes are separate elements, one owned by a
   *  clip and one by the row. Minted by TimelineLanes, the one place that sees
   *  every subtree. */
  lanesId: string;
  contentOrigin: number;
  /** The track's active keyframe clip (selected, else primary) — the one whose
   *  disclosure + property rows this header shows, whether expanded or not. */
  keyframeClip: TimelineElement | null;
  /** Every clip on this track. Automation rows are the track's, unioned over
   *  these, so they stop changing with the selection. */
  trackElements: readonly TimelineElement[];
  /** Clips on this track, so the header can say how many the row holds. */
  clipCount: number;
  isExpanded: boolean;
  animations: readonly GsapAnimation[];
  currentTime: number;
  isTrackHidden: boolean;
  isAudioTrack: boolean;
  rovingTargetId?: string | null;
  theme: TimelineTheme;
  onToggleClipExpanded: () => void;
  onToggleTrackHidden: TimelineEditCallbacks["onToggleTrackHidden"];
  onTogglePropertyGroupKeyframe?: TimelineEditCallbacks["onTogglePropertyGroupKeyframe"];
  /** Drop one envelope. Absent while the lanes are read-only, which is what
   *  hides the control rather than offering a button that cannot act. */
  onRemoveAutomationLane?: (target: string) => void;
  onSeek?: (time: number) => void;
}

function VisibilityButton({
  hidden,
  trackNumber,
  trackDisplayNumber,
  visible,
  onToggle,
}: {
  hidden: boolean;
  trackNumber: number;
  trackDisplayNumber: number | null;
  visible: boolean;
  onToggle: TimelineEditCallbacks["onToggleTrackHidden"];
}) {
  if (!visible) return <span aria-hidden="true" className="h-6 w-6 shrink-0" />;
  // Display number in the text, real key in the callback. The two must not be
  // conflated in either direction.
  const suffix = trackDisplaySuffix(trackDisplayNumber);
  const label = hidden ? `Show track${suffix}` : `Hide track${suffix}`;
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

// The header a track gets when it has no keyframe clip to disclose: label, clip
// count, eye. Not deprecated — it is the live path for every track without lanes.
function PlainTrackHeader({
  trackNumber,
  trackDisplayNumber,
  trackLabel,
  clipCount,
  showTrackLabel,
  isTrackHidden,
  isAudioTrack,
  onToggleTrackHidden,
}: Pick<
  TimelineTrackHeaderProps,
  | "trackNumber"
  | "trackDisplayNumber"
  | "trackLabel"
  | "clipCount"
  | "isTrackHidden"
  | "isAudioTrack"
  | "onToggleTrackHidden"
> & { showTrackLabel: boolean }) {
  return (
    <>
      {isAudioTrack && (
        <Music size={12} weight="fill" aria-hidden="true" className="text-white/35" />
      )}
      {showTrackLabel && (
        <span className="min-w-0 flex-1 truncate text-[11px]" title={trackLabel}>
          {trackLabel}
        </span>
      )}
      {showTrackLabel && <TrackClipCount clipCount={clipCount} />}
      <VisibilityButton
        hidden={isTrackHidden}
        trackNumber={trackNumber}
        trackDisplayNumber={trackDisplayNumber}
        visible
        onToggle={onToggleTrackHidden}
      />
    </>
  );
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
  // The 12x20px glyph is all the lane row has room for, so the WCAG 24x24
  // target is met with a centered transparent ::before overlay instead of a
  // bigger box; focus-visible matches every other control in this header.
  const CHEVRON_BUTTON_CLASS =
    "relative h-5 w-3 border-0 bg-transparent p-0 text-white/55 hover:text-white disabled:text-white/15 " +
    "focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#3CE6AC] " +
    "before:absolute before:left-1/2 before:top-1/2 before:h-6 before:w-6 " +
    "before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']";
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
        className={CHEVRON_BUTTON_CLASS}
        onClick={(event) => {
          event.stopPropagation();
          seekTo(navigation.prevKeyframe);
        }}
      >
        ‹
      </button>
      {children}
      <button
        type="button"
        aria-label={`Next ${label} keyframe`}
        disabled={!navigation.nextKeyframe}
        className={CHEVRON_BUTTON_CLASS}
        onClick={(event) => {
          event.stopPropagation();
          seekTo(navigation.nextKeyframe);
        }}
      >
        ›
      </button>
    </span>
  );
}

function PropertyGroupHeaderRow({
  lanesId,
  lane,
  laneIndex,
  isLastLane,
  expandedElement,
  currentTime,
  clipPercentage,
  gutterBackground,
  columnWidth,
  onTogglePropertyGroupKeyframe,
  onSeek,
  rovingTargetId = null,
}: {
  lanesId: string;
  lane: TimelinePropertyLane;
  laneIndex: number;
  isLastLane: boolean;
  expandedElement: TimelineElement;
  currentTime: number;
  clipPercentage: number;
  gutterBackground: string;
  columnWidth: number;
  onTogglePropertyGroupKeyframe?: TimelineEditCallbacks["onTogglePropertyGroupKeyframe"];
  onSeek?: (time: number) => void;
  rovingTargetId: string | null;
}) {
  const elementId = expandedElement.key ?? expandedElement.id;
  const { navigation, values, label, toggleTarget } = resolveLaneHeaderState(
    lane,
    currentTime,
    clipPercentage,
  );

  return (
    <div
      id={timelineLogicalRowCellId(lanesId, timelinePropertyRowId(elementId, lane.group), "header")}
      data-timeline-focus-id={timelinePropertyRowId(elementId, lane.group)}
      data-timeline-element-id={elementId}
      tabIndex={rovingTargetId === timelinePropertyRowId(elementId, lane.group) ? 0 : -1}
      data-property-group={lane.group}
      data-timeline-lane-top={getTimelineLaneTop(laneIndex)}
      className="absolute left-0 flex items-center gap-1 overflow-hidden px-1.5 text-[10px] text-white/65"
      style={{
        top: getTimelineLaneTop(laneIndex),
        // The header column narrows to contentOrigin whenever that is under
        // LABEL_COL_W; a lane row pinned to LABEL_COL_W then hangs its value
        // readout over the canvas, on top of the clips it is labelling.
        width: columnWidth,
        height: LANE_H,
        background: gutterBackground,
      }}
    >
      {/* Tree connector: vertical spine (top-half on the last lane) + branch tick. */}
      <span className="relative h-full w-3 shrink-0" aria-hidden="true">
        <span
          className="absolute left-1.5 top-0 w-px bg-white/15"
          style={{ height: isLastLane ? "50%" : "100%" }}
        />
        <span className="absolute left-1.5 top-1/2 h-px w-1.5 bg-white/15" />
      </span>
      <span className="w-[46px] shrink-0 truncate text-white" title={label}>
        {label}
      </span>
      <PropertyGroupNavigation
        navigation={navigation}
        label={label}
        expandedElement={expandedElement}
        onSeek={onSeek}
      >
        <button
          type="button"
          aria-pressed={!!navigation.currentKeyframe}
          aria-label={`${navigation.currentKeyframe ? "Remove" : "Add"} ${label} keyframe`}
          title={`${navigation.currentKeyframe ? "Remove" : "Add"} ${label} keyframe`}
          // h-6 w-6 = the 24x24 WCAG 2.2 minimum target; the ◆ glyph stays 11px.
          className="flex h-6 w-6 shrink-0 items-center justify-center border-0 bg-transparent p-0 text-[11px] text-[#3CE6AC] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#3CE6AC]"
          onClick={(event) => {
            // Same as the disclosure caret and the eye: a control in the label
            // column owns its click, it does not also hit the track row behind it.
            event.stopPropagation();
            if (toggleTarget) {
              void onTogglePropertyGroupKeyframe?.(expandedElement, toggleTarget);
            }
          }}
        >
          {navigation.currentKeyframe ? "◆" : "◇"}
        </button>
      </PropertyGroupNavigation>
      <span
        className="min-w-0 flex-1 truncate text-right tabular-nums text-white/45"
        title={valueReadout(lane.group, values)}
      >
        {valueReadout(lane.group, values)}
      </span>
    </div>
  );
}

/**
 * One envelope's row in the label column.
 *
 * Named here rather than inside the lane, on the same tree connector the
 * keyframe rows use: an automation lane is a child of its clip exactly as a
 * property group is, and drawing its name over the envelope put the label on top
 * of the curve it describes and scrolled it away from its own row.
 */
function AutomationLaneHeaderRow({
  target,
  label,
  name,
  param,
  top,
  isLastLane,
  gutterBackground,
  columnWidth,
  onRemove,
}: {
  /** The lane the ACTIVE clip draws in this row, or null when it draws none —
   *  the row belongs to the property, and a clip may be absent from it. */
  target: string | null;
  /** The whole thing on one line: the row's identity, its tooltip, and the
   *  remove button's name. */
  label: string;
  /** What the effect is — "Peaking EQ 1.6 kHz". */
  name: string;
  /** Which knob the envelope drives. Empty when there is no second line to draw. */
  param: string;
  top: number;
  isLastLane: boolean;
  gutterBackground: string;
  columnWidth: number;
  onRemove?: (target: string) => void;
}) {
  return (
    <div
      data-automation-lane-label={label}
      data-timeline-lane-top={top}
      className="absolute left-0 flex items-center gap-1 overflow-hidden px-1.5 text-[10px] text-white/65"
      style={{
        top,
        width: columnWidth,
        height: AUTOMATION_LANE_H,
        background: gutterBackground,
      }}
    >
      {/* Tree connector, as the keyframe rows draw it: spine down the row, branch
          tick at the name's own height. */}
      <span className="relative h-full w-3 shrink-0" aria-hidden="true">
        <span
          className="absolute left-1.5 top-0 w-px bg-white/15"
          style={{ height: isLastLane ? "50%" : "100%" }}
        />
        <span className="absolute left-1.5 top-1/2 h-px w-1.5 bg-white/15" />
      </span>
      {/* Two lines: what the effect is, then which knob the envelope drives. On
          one line a band's own name was the first thing truncated in a column this
          narrow — "Peaking EQ 1.6 k…" — losing exactly the part that tells two
          bands apart. */}
      <span className="flex min-w-0 flex-1 flex-col justify-center leading-tight" title={label}>
        <span data-automation-lane-name="" className="truncate font-mono text-[9px] text-white/70">
          {name}
        </span>
        {param ? (
          <span
            data-automation-lane-param=""
            className="truncate font-mono text-[9px] text-white/40"
          >
            {param}
          </span>
        ) : null}
      </span>
      {/* Beside the name it labels, because that is the only place an envelope is
          named at all: a carve writes its own lanes, and the FX panel's automate
          toggle can only reach a parameter it still lists — so without this an
          envelope could be created and never removed.

          Only for the clip the header is showing, since that is the only one a
          write can reach: a shared row's other envelopes belong to clips that
          are not selected, and a button that silently removed one of them (or
          none) would be worse than no button. */}
      {onRemove && target !== null && (
        <button
          type="button"
          aria-label={`Remove ${label} automation`}
          title={`Remove ${label} automation`}
          // h-6 w-6 is the 24x24 WCAG 2.2 target; the glyph stays small.
          className="flex h-6 w-6 shrink-0 items-center justify-center border-0 bg-transparent p-0 text-[11px] text-white/35 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#3CE6AC]"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            // A control in the label column owns its click; it does not also hit
            // the track row behind it and change the selection.
            event.stopPropagation();
            onRemove(target);
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

export function TimelineTrackHeader({
  trackNumber,
  trackDisplayNumber,
  trackLabel,
  lanesId,
  contentOrigin,
  keyframeClip,
  trackElements,
  clipCount,
  isExpanded,
  animations,
  currentTime,
  isTrackHidden,
  isAudioTrack,
  theme,
  onToggleClipExpanded,
  onToggleTrackHidden,
  onTogglePropertyGroupKeyframe,
  onRemoveAutomationLane,
  onSeek,
  rovingTargetId = null,
}: TimelineTrackHeaderProps) {
  const clipPercentage = keyframeClip
    ? ((currentTime - keyframeClip.start) / keyframeClip.duration) * 100
    : 0;
  const lanes = keyframeClip
    ? // clipTimingStart, not the raw start: an expanded sub-comp child's start is
      // host-absolute while its tweens are local to its own file.
      getTimelinePropertyLanes(animations, clipTimingStart(keyframeClip), keyframeClip.duration)
    : [];
  // Label mode = keyframe view; the label column stays LABEL_COL_W (Timeline.tsx
  // owns the gutter past it, so a 0% diamond isn't clipped by this panel).
  const showTrackLabel = contentOrigin >= LABEL_COL_W;
  // One row per automated property across the whole track, in the order the
  // canvas draws them — a name beside the wrong envelope is worse than an awkward
  // order. `target` is the ACTIVE clip's lane in that row, which is the only one
  // the remove button can write to; null when the row belongs to its siblings.
  const activeKey = keyframeClip ? (keyframeClip.key ?? keyframeClip.id) : null;
  const automationRows = groupAutomationLanes(trackElements).map((group) => ({
    key: group.key,
    label: group.key,
    name: group.name,
    param: group.param,
    target:
      group.entries.find((entry) => (entry.element.key ?? entry.element.id) === activeKey)?.lane
        .target ?? null,
  }));
  // Automation counts as something to disclose: gating the caret on tweens alone
  // left an audio clip's envelopes unreachable, since the track could not expand.
  const disclosable = lanes.length > 0 || automationRows.length > 0;
  const isKeyframeLayer = !!keyframeClip && disclosable;

  return (
    <div
      role="rowheader"
      aria-colindex={1}
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
      {!keyframeClip || !disclosable ? (
        <PlainTrackHeader
          trackNumber={trackNumber}
          trackDisplayNumber={trackDisplayNumber}
          trackLabel={trackLabel}
          clipCount={clipCount}
          showTrackLabel={showTrackLabel}
          isTrackHidden={isTrackHidden}
          isAudioTrack={isAudioTrack}
          onToggleTrackHidden={onToggleTrackHidden}
        />
      ) : (
        <>
          <LayerDisclosureRow
            name={
              // A row holding several clips is named for the track, not for
              // whichever of them is selected — the lanes below it are the
              // track's, shared per property, and naming it "Narration 2" read
              // as if they all belonged to that one slice.
              clipCount > 1
                ? `Track${trackDisplaySuffix(trackDisplayNumber)}`
                : (keyframeClip.label ?? keyframeClip.domId ?? keyframeClip.id)
            }
            clipCount={clipCount}
            isExpanded={isExpanded}
            gutterBackground={theme.gutterBackground}
            columnWidth={showTrackLabel ? LABEL_COL_W : contentOrigin}
            lanesId={lanesId}
            onToggleClipExpanded={onToggleClipExpanded}
          >
            {/* The eye belongs to the LAYER, so it lives on the always-mounted
                layer row exactly like a plain track's. Hanging it off a lane row
                (hover-gated, and only while expanded) left a keyframed track with
                no way to be hidden at all by keyboard, and put the control on a
                row it does not act on. */}
            <VisibilityButton
              hidden={isTrackHidden}
              trackNumber={trackNumber}
              trackDisplayNumber={trackDisplayNumber}
              visible
              onToggle={onToggleTrackHidden}
            />
          </LayerDisclosureRow>
          {/* The caret expands TWO disjoint subtrees: these label-column rows,
              which carry the per-lane keyframe controls, and the diamond lanes
              on the canvas. `lanesId` names the canvas lanes (rendered by
              TimelineLanes), because that is what a sighted user watches appear
              and what following the reference has to land on. These rows are not
              empty and are not the target; they are absolutely positioned inside
              the sticky column, which is what made a wrapper HERE compute to
              0x0 and hold no diamonds. */}
          {isExpanded &&
            lanes.map((lane, laneIndex) => (
              <PropertyGroupHeaderRow
                key={lane.group}
                lanesId={lanesId}
                lane={lane}
                laneIndex={laneIndex}
                isLastLane={laneIndex === lanes.length - 1 && automationRows.length === 0}
                expandedElement={keyframeClip}
                currentTime={currentTime}
                clipPercentage={clipPercentage}
                gutterBackground={theme.gutterBackground}
                columnWidth={showTrackLabel ? LABEL_COL_W : contentOrigin}
                onTogglePropertyGroupKeyframe={onTogglePropertyGroupKeyframe}
                onSeek={onSeek}
                rovingTargetId={rovingTargetId}
              />
            ))}
          {/* Below the keyframe rows and stepping by its own height, which is how
              TimelineAutomationLaneSlot lays the envelopes out on the canvas. The
              two have to agree or a name labels the wrong curve. */}
          {isExpanded &&
            automationRows.map((row, index) => (
              <AutomationLaneHeaderRow
                key={row.key}
                target={row.target}
                label={row.label}
                name={row.name}
                param={row.param}
                top={getTimelineLaneTop(lanes.length) + index * AUTOMATION_LANE_H}
                isLastLane={index === automationRows.length - 1}
                gutterBackground={theme.gutterBackground}
                columnWidth={showTrackLabel ? LABEL_COL_W : contentOrigin}
                onRemove={onRemoveAutomationLane}
              />
            ))}
        </>
      )}
    </div>
  );
}
