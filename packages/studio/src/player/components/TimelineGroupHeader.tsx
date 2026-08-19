import { SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import type { HfAudioFxChain } from "@hyperframes/core/audio-fx";
import { TRACK_H } from "./timelineLayout";
import type { TimelineTheme } from "./timelineTheme";
import { TimelineFxButton } from "./TimelineFxButton";
import type { AuditionSpan } from "../../components/editor/useAuditionTransport.js";

interface TimelineGroupHeaderProps {
  label: string;
  memberCount: number;
  /** Caret: shows/hides the member rows beneath this group (structural). */
  isExpanded: boolean;
  onToggleExpanded: () => void;
  /** `∿`: shows/hides the group's own automation-lane rows. */
  laneCount: number;
  isLaneOpen: boolean;
  onToggleLanes: () => void;
  /** The group element's own `data-hidden` — mutes every member at once. */
  hidden: boolean;
  onToggleHidden: () => void;
  /** This group id is itself in the soloed set (fully lit). */
  isSoloed: boolean;
  /** Not soloed itself, but at least one member is (half-lit). */
  isHalfLitSolo: boolean;
  /** `add: true` (⌘/Ctrl-click) toggles membership; a plain click is exclusive. */
  onToggleSolo: (options?: { add?: boolean }) => void;
  /** C1: the group's serialized `data-fx-chain`, when set. */
  fxChain?: string;
  onFxChainChange: (next: HfAudioFxChain) => void;
  onFxChainPreview?: (next: HfAudioFxChain) => void;
  /** Member clips, so hovering a preset auditions where the group sounds. */
  auditionSpans?: readonly AuditionSpan[];
  /** Set the group mute on the running graph only, so an audition can lift it. */
  onSetMutedLive?: (muted: boolean) => void;
  onOpenFxRack: () => void;
  columnWidth: number;
  theme: TimelineTheme;
}

/**
 * A group's own row header: caret (member disclosure) + `▤` + label + count +
 * mute + solo + FX + `∿ n` (lane disclosure).
 */

/**
 * The group's name, which IS the way into its rack — a group is an element
 * carrying `data-fx-chain`, so selecting it is what puts the chain in the
 * property panel. Its own component because the header it sits in already
 * carries six controls and was over the complexity gate with this inline.
 */
function GroupNameButton({
  label,
  memberCount,
  hidden,
  onOpenFxRack,
}: {
  label: string;
  memberCount: number;
  hidden: boolean;
  onOpenFxRack: () => void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={`Open ${label} effects`}
      title="Open effects"
      className="flex min-w-0 flex-1 items-center gap-1.5 rounded border-0 bg-transparent p-0 text-left text-[11px] text-white hover:text-[#3CE6AC] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#3CE6AC]"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onOpenFxRack();
      }}
    >
      <span aria-hidden="true" className="shrink-0 text-[12px] leading-none text-white/50">
        ▤
      </span>
      {/* Struck through, not merely dimmed — the designs are explicit that "a
          muted track that only looks dim is a track someone re-mutes by
          accident", and a muted GROUP silences every member at once, so it is
          the most expensive one to misread. */}
      <span className={`min-w-0 truncate font-medium${hidden ? " line-through" : ""}`}>
        {label}
      </span>
      <span
        className="shrink-0 rounded-full bg-white/10 px-1 text-[9px] leading-[14px] tabular-nums text-white/55"
        aria-hidden="true"
        title={`${memberCount} tracks`}
      >
        {memberCount}
      </span>
      {/* Eats the slack so the count sits beside the name rather than drifting
          to the far edge, while the button itself stays full width — the whole
          name line is the target that opens the rack. */}
      <span aria-hidden="true" className="min-w-0 flex-1" />
    </button>
  );
}

export function TimelineGroupHeader({
  label,
  memberCount,
  isExpanded,
  onToggleExpanded,
  laneCount,
  isLaneOpen,
  onToggleLanes,
  hidden,
  onToggleHidden,
  isSoloed,
  isHalfLitSolo,
  onToggleSolo,
  fxChain,
  onFxChainChange,
  onFxChainPreview,
  auditionSpans,
  onSetMutedLive,
  onOpenFxRack,
  columnWidth,
  theme,
}: TimelineGroupHeaderProps) {
  return (
    <div
      role="rowheader"
      aria-colindex={1}
      className="sticky left-0 z-[12] flex shrink-0 flex-col justify-center gap-0.5 overflow-hidden px-1.5 text-[11px]"
      style={{
        width: columnWidth,
        height: TRACK_H,
        color: "#ffffff",
        background: theme.gutterBackground,
        borderRight: `1px solid ${theme.gutterBorder}`,
      }}
    >
      {/* Line one: what the row IS. The caret rides with the name because it
          discloses the name's contents. */}
      <div className="flex min-w-0 items-center gap-1.5">
        <button
          type="button"
          tabIndex={-1}
          aria-expanded={isExpanded}
          aria-label={`${isExpanded ? "Hide" : "Show"} ${label} tracks`}
          title={`${isExpanded ? "Hide" : "Show"} tracks`}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border-0 bg-transparent p-0 text-[11px] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#3CE6AC] ${
            isExpanded ? "text-white" : "text-white/55 hover:text-white"
          }`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpanded();
          }}
        >
          <span aria-hidden="true" style={{ transform: isExpanded ? "rotate(90deg)" : undefined }}>
            ▸
          </span>
        </button>
        <GroupNameButton
          label={label}
          memberCount={memberCount}
          hidden={hidden}
          onOpenFxRack={onOpenFxRack}
        />
      </div>
      {/* Line two: what you can DO to it. Its own row so the name is not
          squeezed to a few characters by five controls sharing 232px. */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          tabIndex={-1}
          aria-label={hidden ? "Unmute group" : `Mute group ${label}`}
          title={hidden ? "Unmute group" : `Mute group ${label}`}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border-0 bg-transparent p-0 transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-[#3CE6AC] ${
            hidden ? "text-[#3CE6AC] hover:text-white" : "text-white/55 hover:text-white"
          }`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onToggleHidden();
          }}
        >
          {hidden ? (
            <SpeakerSlash size={14} weight="bold" aria-hidden="true" />
          ) : (
            <SpeakerHigh size={14} weight="bold" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-pressed={isSoloed}
          aria-label="Hear only this"
          title="Hear only this"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded border-0 bg-transparent p-0 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-[#3CE6AC]"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onToggleSolo({ add: event.metaKey || event.ctrlKey });
          }}
        >
          {/* Three states, not two: filled when this group is soloed, and
              HALF-lit when a member is — the affordance for "this bus is
              passing audio, but I did not solo it" (groups doc §2.2). */}
          <span
            aria-hidden="true"
            className={`flex h-[15px] w-[15px] items-center justify-center rounded-[3px] border text-[10px] font-bold leading-none transition-colors ${
              isSoloed
                ? "border-[#F5C542] bg-[#F5C542] text-black"
                : isHalfLitSolo
                  ? "border-[#F5C542]/60 bg-[#F5C542]/25 text-[#F5C542]"
                  : "border-white/30 text-white/45 hover:border-white/60 hover:text-white/80"
            }`}
          >
            S
          </span>
        </button>
        <TimelineFxButton
          fxChainRaw={fxChain}
          onChainChange={onFxChainChange}
          onChainPreview={onFxChainPreview}
          auditionSpans={auditionSpans}
          isMuted={hidden}
          onSetMutedLive={onSetMutedLive}
          onOpenRack={onOpenFxRack}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-expanded={isLaneOpen}
          aria-label={`${isLaneOpen ? "Hide" : "Show"} ${label} lanes`}
          title={`${isLaneOpen ? "Hide" : "Show"} lanes`}
          className={`flex h-6 items-center justify-center gap-0.5 rounded border-0 bg-transparent px-1 text-[11px] leading-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#3CE6AC] ${
            isLaneOpen ? "text-[#3CE6AC]" : "text-white/55 hover:text-white"
          }`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onToggleLanes();
          }}
        >
          <span aria-hidden="true">∿</span>
          {laneCount > 0 && (
            <span className="text-[9px] tabular-nums text-white/55">{laneCount}</span>
          )}
        </button>
      </div>
    </div>
  );
}
