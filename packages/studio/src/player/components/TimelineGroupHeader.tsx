import { SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import type { HfAudioFxChain } from "@hyperframes/core/audio-fx";
import { TRACK_H } from "./timelineLayout";
import type { TimelineTheme } from "./timelineTheme";
import { TimelineFxButton } from "./TimelineFxButton";

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
  onFxAuditionTransport?: (on: boolean) => void;
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
  onFxAuditionTransport,
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
        // Mono, like both of the property panel's disclosure carets. The size is
        // this row's own call and not a match to either of them: the node-body
        // caret sits under `text-[9px]`, and `hf-fx-preset-run-caret` has no
        // size rule at all, so there is no measured target to match.
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border-0 bg-transparent p-0 font-mono text-[13px] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#3CE6AC] ${
          isExpanded ? "text-white" : "text-white/55 hover:text-white"
        }`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onToggleExpanded();
        }}
      >
        {/* Swapped, not rotated: both panel carets swap, and a rotated ▸ sits
            off-centre in its box because the glyph is not square. */}
        <span aria-hidden="true">{isExpanded ? "▾" : "▸"}</span>
      </button>
      <span aria-hidden="true" className="shrink-0 text-[12px] leading-none text-white/50">
        ▤
      </span>
      <span className="min-w-0 flex-1 truncate font-medium" title={label}>
        {label}
      </span>
      <span
        className="shrink-0 rounded-full bg-white/10 px-1 text-[9px] leading-[14px] tabular-nums text-white/55"
        aria-hidden="true"
        title={`${memberCount} tracks`}
      >
        {memberCount}
      </span>
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
        onAuditionTransport={onFxAuditionTransport}
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
