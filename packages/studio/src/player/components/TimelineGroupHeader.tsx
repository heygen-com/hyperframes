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
      className="sticky left-0 z-[12] flex shrink-0 items-center gap-1.5 overflow-hidden px-1.5 text-[11px]"
      style={{
        width: columnWidth,
        height: TRACK_H,
        color: "#ffffff",
        background: theme.gutterBackground,
        borderRight: `1px solid ${theme.gutterBorder}`,
      }}
    >
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
      {/* The group's name IS the way into its rack. A group is an element
          carrying `data-fx-chain`, so selecting it is what puts the chain in
          the property panel — but nothing on this row said so, and the FX
          popover's footer was the only route to it. A button rather than a
          click handler on the row: it has to be reachable by keyboard, and the
          sibling controls each stopPropagation already, so widening the target
          to the whole row would only add ambiguity over their hit areas. */}
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
        <span className={`min-w-0 flex-1 truncate font-medium${hidden ? " line-through" : ""}`}>
          {label}
        </span>
        <span
          className="shrink-0 rounded-full bg-white/10 px-1 text-[9px] leading-[14px] tabular-nums text-white/55"
          aria-hidden="true"
          title={`${memberCount} tracks`}
        >
          {memberCount}
        </span>
      </button>
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
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border-0 bg-transparent p-0 text-[13px] font-semibold transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-[#3CE6AC] ${
          isSoloed
            ? "text-[#F5C542] hover:text-white"
            : isHalfLitSolo
              ? "text-[#F5C542]/50 hover:text-white"
              : "text-white/35 hover:text-white/75"
        }`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onToggleSolo({ add: event.metaKey || event.ctrlKey });
        }}
      >
        <span aria-hidden="true">⌗</span>
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
  );
}
