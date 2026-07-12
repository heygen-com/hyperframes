import { Eye, EyeSlash } from "@phosphor-icons/react";
import { Music } from "../../icons/SystemIcons";
import type { TimelineTheme } from "./timelineTheme";
import { GUTTER } from "./timelineLayout";

interface TimelineLayerGutterProps {
  isAudio: boolean;
  isTrackHidden: boolean;
  rowTrack: number;
  theme: TimelineTheme;
  onToggleHidden: () => void;
}

export function TimelineLayerGutter({
  isAudio,
  isTrackHidden,
  rowTrack,
  theme,
  onToggleHidden,
}: TimelineLayerGutterProps) {
  return (
    <div
      className="sticky left-0 z-[12] flex-shrink-0 flex flex-col items-center justify-center gap-0.5"
      style={{
        width: GUTTER,
        background: theme.gutterBackground,
        borderRight: `1px solid ${theme.gutterBorder}`,
      }}
    >
      {isAudio && (
        <Music
          size={12}
          weight="fill"
          aria-hidden="true"
          style={{ color: theme.textSecondary, opacity: 0.7 }}
        />
      )}
      <button
        type="button"
        aria-label={isTrackHidden ? `Show track ${rowTrack}` : `Hide track ${rowTrack}`}
        title={isTrackHidden ? `Show track ${rowTrack}` : `Hide track ${rowTrack}`}
        className={`flex h-6 w-6 items-center justify-center rounded border-0 bg-transparent p-0 transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-[#3CE6AC] ${
          isTrackHidden ? "text-[#3CE6AC] hover:text-white" : "text-white/35 hover:text-white/75"
        }`}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
          onToggleHidden();
        }}
      >
        {isTrackHidden ? (
          <EyeSlash size={14} weight="bold" aria-hidden="true" />
        ) : (
          <Eye size={14} weight="bold" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
