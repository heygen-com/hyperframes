import type React from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import { Music } from "../../icons/SystemIcons";
import type { TimelineEditCallbacks } from "./timelineCallbacks";
import { TrackClipCount } from "./TrackClipCount";
import { trackDisplaySuffix } from "./timelineTrackDisplay";

// Hide, plainly. The speaker variant was the mute presentation; with mute gone
// this is the visibility eye it always was, and audio rows do not render it.
function visibilityButtonLabel(hidden: boolean, suffix: string): string {
  return hidden ? `Show track${suffix}` : `Hide track${suffix}`;
}

function visibilityButtonIcon(hidden: boolean) {
  const Icon = hidden ? EyeSlash : Eye;
  return <Icon size={14} weight="bold" aria-hidden="true" />;
}

export function VisibilityButton({
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
  const label = visibilityButtonLabel(hidden, suffix);
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
        // Display number alongside the real key: the undo-history label must
        // announce the same row this button just did (see `onToggleTrackHidden`).
        void onToggle?.(trackNumber, !hidden, trackDisplayNumber);
      }}
    >
      {visibilityButtonIcon(hidden)}
    </button>
  );
}

// The header a track gets when it has no keyframe clip to disclose: label, clip
// count, eye. Not deprecated — it is the live path for every track without lanes.
export function PlainTrackHeader({
  trackNumber,
  trackDisplayNumber,
  trackLabel,
  clipCount,
  showTrackLabel,
  isTrackHidden,
  isAudioTrack,
  onToggleTrackHidden,
  trailing,
}: {
  trackNumber: number;
  trackDisplayNumber: number | null;
  trackLabel: string;
  clipCount: number;
  isTrackHidden: boolean;
  isAudioTrack: boolean;
  onToggleTrackHidden: TimelineEditCallbacks["onToggleTrackHidden"];
  showTrackLabel: boolean;
  /** Trailing controls that belong on the control line — the FX entry points,
   *  which the caller owns because only it knows the clip they act on. */
  trailing?: React.ReactNode;
}) {
  return (
    <>
      {/* One line: the name, then every control pushed to the right edge. The
          two-line split this replaced existed to stop four controls truncating
          the name — but the name already truncates on its own (`min-w-0` plus
          `truncate`), and the controls are `shrink-0`, so they hold the edge
          and the name gives way instead. */}
      <div className="flex min-w-0 items-center gap-1">
        {isAudioTrack && (
          <Music size={12} weight="fill" aria-hidden="true" className="text-white/35" />
        )}
        {/* No `flex-1`: the name takes only the width it needs, so the clip
            count sits against it rather than being pushed out to meet the
            controls. The slack goes to the `ml-auto` group below instead.

            Wraps rather than truncating: a truncated name needs a hover to be
            read at all, and a tooltip is no use to a name you are scanning a
            column of. `break-words` so a long single token breaks instead of
            forcing the column wider. */}
        {showTrackLabel && (
          <span className="min-w-0 break-words text-[11px] leading-tight">{trackLabel}</span>
        )}
        {showTrackLabel && <TrackClipCount clipCount={clipCount} />}
        {/* `ml-auto` is what anchors the group right: it absorbs the slack the
            truncating name leaves, so the controls sit on the edge whatever the
            name's length. */}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {/* Not on an audio track. The control is the old visibility eye, and
            on audio it silences rather than hides — but a row that already says
            what it is with a speaker does not also need the hide affordance
            sitting in the eye's slot. `visible={false}` rather than omitting the
            element, so the spacer keeps every row's control columns aligned.

            EXCEPT when the audio track is ALREADY hidden. Withholding the
            control unconditionally withheld the only way back: `data-hidden`
            silences the clip in preview and drops it from the render, the
            panel's "Muted" is the unrelated HTML `muted` attribute, and nothing
            else writes it — so a track hidden before this rule (or by "Hide
            all", or by hand) was silent with no control anywhere to restore it.
            Offering the eye only in that state keeps the affordance off a normal
            audio row while leaving the door open from the inside. */}
          <VisibilityButton
            hidden={isTrackHidden}
            trackNumber={trackNumber}
            trackDisplayNumber={trackDisplayNumber}
            visible={!isAudioTrack || isTrackHidden}
            onToggle={onToggleTrackHidden}
          />
          {trailing}
        </div>
      </div>
    </>
  );
}
