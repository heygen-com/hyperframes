import type { TimelineTheme } from "./timelineTheme";

interface TimelineShortcutHintProps {
  theme: TimelineTheme;
}

export function TimelineShortcutHint({ theme }: TimelineShortcutHintProps) {
  return (
    <div className="absolute bottom-2 right-3 pointer-events-none z-20">
      <div
        className="flex items-center gap-1.5 px-2 py-1 rounded-md border"
        style={{ background: "rgba(17,23,35,0.84)", borderColor: theme.gutterBorder }}
      >
        <kbd
          className="text-[9px] font-mono px-1 py-0.5 rounded"
          style={{ color: theme.textSecondary, background: "rgba(255,255,255,0.06)" }}
        >
          Shift
        </kbd>
        <span className="text-[9px]" style={{ color: theme.textSecondary }}>
          + drag/click to edit range
        </span>
      </div>
    </div>
  );
}
