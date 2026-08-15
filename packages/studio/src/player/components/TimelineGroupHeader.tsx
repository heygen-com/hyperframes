import { TRACK_H } from "./timelineLayout";
import type { TimelineTheme } from "./timelineTheme";

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
  columnWidth: number;
  theme: TimelineTheme;
}

/**
 * A group's own row header: caret (member disclosure) + `▤` + label + `∿ n`
 * (lane disclosure). Mute/solo (B5) and the FX entry point (C1) land here as
 * siblings once those steps exist — nothing to reserve for them yet.
 */
export function TimelineGroupHeader({
  label,
  memberCount,
  isExpanded,
  onToggleExpanded,
  laneCount,
  isLaneOpen,
  onToggleLanes,
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
