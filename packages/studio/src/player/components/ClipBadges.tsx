import { memo } from "react";
import type { TimelineElement } from "../store/playerStore";
import { readClipBadges, splitVisibleBadges, type ClipBadge } from "./clipToolAttrs";
import { useClipToolState } from "./useClipToolState";

function SpeakerGlyph({ muted }: { muted: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor" />
      {muted ? (
        <path d="M11 6l4 4M15 6l-4 4" stroke="currentColor" strokeWidth="1.4" />
      ) : (
        <path
          d="M11 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9"
          stroke="currentColor"
          fill="none"
          strokeWidth="1.4"
        />
      )}
    </svg>
  );
}

function BadgeContent({ badge }: { badge: ClipBadge }) {
  if (badge.kind === "link") return <span aria-hidden="true">🔗</span>;
  if (badge.kind === "volume") {
    const muted = badge.label === "Muted";
    return (
      <>
        <SpeakerGlyph muted={muted} />
        {muted ? null : <span>{badge.label}</span>}
      </>
    );
  }
  return <span>{badge.label}</span>;
}

const BADGE_CLASS =
  "inline-flex items-center gap-0.5 rounded-[3px] border border-white/20 bg-black/55 px-1 text-[9px] leading-[14px] text-white/90 whitespace-nowrap";

/** What is applied to a clip, read from its attributes: a link badge, then at most two more and `+N`. */
export const ClipBadges = memo(function ClipBadges({ el }: { el: TimelineElement }) {
  const state = useClipToolState(el);
  const { visible, hidden } = splitVisibleBadges(readClipBadges(state));
  if (visible.length === 0) return null;
  return (
    <span
      className="pointer-events-none absolute right-1.5 top-0.5 z-[3] flex max-w-[calc(100%-12px)] gap-1 overflow-hidden"
      data-testid="clip-badges"
    >
      {visible.map((badge) => (
        <span key={badge.kind} className={BADGE_CLASS} title={badge.label} data-badge={badge.kind}>
          <BadgeContent badge={badge} />
        </span>
      ))}
      {hidden.length > 0 && (
        <span
          className={`${BADGE_CLASS} pointer-events-auto`}
          title={hidden.map((badge) => badge.label).join(", ")}
          data-badge="more"
        >
          +{hidden.length}
        </span>
      )}
    </span>
  );
});
