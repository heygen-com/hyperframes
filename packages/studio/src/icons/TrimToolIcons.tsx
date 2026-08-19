import type { ReactElement } from "react";
import type { TimelineTrimMode } from "../player/components/timelineTrimOps";

/**
 * Glyphs for the four trim tools. Hand-drawn rather than pulled from Phosphor:
 * the set has no marks for these operations, and what matters here is that the
 * four read as *different* at 16px — each one shows what moves.
 *
 * Shared grammar: a solid block is a clip, a vertical rule is an edit point,
 * an arrow is what the drag moves.
 */

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

interface TrimToolIconProps {
  size?: number;
}

/** Ripple: an edit point, and the rest of the track pushed along behind it. */
function RippleTrimIcon({ size = 16 }: TrimToolIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1" y="4.5" width="3.5" height="7" rx="1" fill="currentColor" />
      <path d="M6.5 8h6.5M10.5 5.5 13 8l-2.5 2.5" {...STROKE} />
    </svg>
  );
}

/** Roll: one edit point, movable either way; the clips around it stay put. */
function RollEditIcon({ size = 16 }: TrimToolIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.5v11" {...STROKE} strokeWidth={1.6} />
      <path d="M5 5.5 2.5 8 5 10.5M11 5.5 13.5 8 11 10.5" {...STROKE} />
    </svg>
  );
}

/** Slip: the clip's outline stays; the media inside it slides. */
function SlipEditIcon({ size = 16 }: TrimToolIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.7" y="3.7" width="12.6" height="8.6" rx="1.6" {...STROKE} />
      <path d="M5 8h6M6.6 6.4 5 8l1.6 1.6M9.4 6.4 11 8 9.4 9.6" {...STROKE} />
    </svg>
  );
}

/** Slide: the clip travels; the walls either side of it absorb the travel. */
function SlideEditIcon({ size = 16 }: TrimToolIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.6 2.8v7.4M14.4 2.8v7.4" {...STROKE} />
      <rect x="5" y="2.8" width="6" height="7.4" rx="1" fill="currentColor" />
      <path d="M3 13.2h10M4.6 11.6 3 13.2l1.6 1.6M11.4 11.6 13 13.2l-1.6 1.6" {...STROKE} />
    </svg>
  );
}

export const TRIM_TOOL_ICONS: Record<TimelineTrimMode, (p: TrimToolIconProps) => ReactElement> = {
  ripple: RippleTrimIcon,
  roll: RollEditIcon,
  slip: SlipEditIcon,
  slide: SlideEditIcon,
};
