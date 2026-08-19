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
        void onToggle?.(trackNumber, !hidden);
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
      {/* Line one: what the row IS. Line two (below) is what you can do to it —
          the same split the group header uses, for the same reason: a name and
          four controls sharing 232px truncated the name to a few characters. */}
      <div className="flex min-w-0 items-center gap-1">
        {isAudioTrack && (
          <Music size={12} weight="fill" aria-hidden="true" className="text-white/35" />
        )}
        {showTrackLabel && (
          <span className="min-w-0 flex-1 truncate text-[11px]" title={trackLabel}>
            {trackLabel}
          </span>
        )}
        {showTrackLabel && <TrackClipCount clipCount={clipCount} />}
      </div>
      <div className="flex items-center gap-1">
        {/* Not on an audio track. The control is the old visibility eye, and on
          audio it silences rather than hides — but a row that already says what
          it is with a speaker does not also need the hide affordance sitting in
          the eye's slot. `visible={false}` rather than omitting the element, so
          the spacer keeps every row's control columns aligned. */}
        <VisibilityButton
          hidden={isTrackHidden}
          trackNumber={trackNumber}
          trackDisplayNumber={trackDisplayNumber}
          visible={!isAudioTrack}
          onToggle={onToggleTrackHidden}
        />
        {trailing}
      </div>
    </>
  );
}
