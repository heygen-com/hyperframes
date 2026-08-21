import { Eye, EyeSlash, SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import { Music } from "../../icons/SystemIcons";
import { TimelineSoloButton } from "./TimelineSoloButton";
import type { TimelineEditCallbacks } from "./timelineCallbacks";
import { TrackClipCount } from "./TrackClipCount";
import { trackDisplaySuffix } from "./timelineTrackDisplay";

/**
 * Audio tracks say "Mute", not "Hide" — the eye IS mute for sound-only rows.
 *
 * Action-phrased and per-track, like the visual branch: `hidden` here is the
 * CURRENT state, so the name has to promise the opposite. It read "Muted" /
 * "Mute" until the rollout, which named the state instead of the action (a
 * screen-reader user could not tell that activating an already-muted row would
 * unmute it) and dropped `suffix`, so every audio row shared one accessible
 * name — music plus VO being the ordinary case. The wording matches the undo
 * entry `timelineTrackVisibility` writes for the same click, where `hidden` is
 * the INCOMING state and the two therefore read inverted.
 */
function visibilityButtonLabel(showAsMute: boolean, hidden: boolean, suffix: string): string {
  if (showAsMute) return hidden ? `Unmute track${suffix}` : `Mute track${suffix}`;
  return hidden ? `Show track${suffix}` : `Hide track${suffix}`;
}

function visibilityButtonIcon(showAsMute: boolean, hidden: boolean) {
  const Icon = showAsMute ? (hidden ? SpeakerSlash : SpeakerHigh) : hidden ? EyeSlash : Eye;
  return <Icon size={14} weight="bold" aria-hidden="true" />;
}

export function VisibilityButton({
  hidden,
  trackNumber,
  trackDisplayNumber,
  visible,
  isAudioTrack,
  onToggle,
}: {
  hidden: boolean;
  trackNumber: number;
  trackDisplayNumber: number | null;
  visible: boolean;
  isAudioTrack?: boolean;
  onToggle: TimelineEditCallbacks["onToggleTrackHidden"];
}) {
  if (!visible) return <span aria-hidden="true" className="h-6 w-6 shrink-0" />;
  // Display number in the text, real key in the callback. The two must not be
  // conflated in either direction.
  const suffix = trackDisplaySuffix(trackDisplayNumber);
  const showAsMute = Boolean(isAudioTrack);
  const label = visibilityButtonLabel(showAsMute, hidden, suffix);
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
        void onToggle?.(trackNumber, !hidden, trackDisplayNumber);
      }}
    >
      {visibilityButtonIcon(showAsMute, hidden)}
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
  isGroupMuted,
  isSoloed,
  onToggleSolo,
  onToggleTrackHidden,
}: {
  trackNumber: number;
  trackDisplayNumber: number | null;
  trackLabel: string;
  clipCount: number;
  isTrackHidden: boolean;
  isAudioTrack: boolean;
  onToggleTrackHidden: TimelineEditCallbacks["onToggleTrackHidden"];
  showTrackLabel: boolean;
  isGroupMuted: boolean;
  isSoloed: boolean;
  onToggleSolo?: (options?: { add?: boolean }) => void;
}) {
  return (
    <>
      {isAudioTrack && (
        <Music size={12} weight="fill" aria-hidden="true" className="text-white/35" />
      )}
      {showTrackLabel && (
        <span
          className={`min-w-0 flex-1 truncate text-[11px] ${
            isAudioTrack && (isTrackHidden || isGroupMuted) ? "line-through" : ""
          }`}
          title={isGroupMuted && !isTrackHidden ? `${trackLabel} (group muted)` : trackLabel}
        >
          {trackLabel}
        </span>
      )}
      {showTrackLabel && <TrackClipCount clipCount={clipCount} />}
      <VisibilityButton
        hidden={isTrackHidden}
        trackNumber={trackNumber}
        trackDisplayNumber={trackDisplayNumber}
        visible
        isAudioTrack={isAudioTrack}
        onToggle={onToggleTrackHidden}
      />
      {isAudioTrack && onToggleSolo && (
        <TimelineSoloButton isSoloed={isSoloed} onToggle={onToggleSolo} />
      )}
    </>
  );
}
