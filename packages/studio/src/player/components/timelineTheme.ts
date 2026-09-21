import type { TimelineElement } from "../store/playerStore";

export interface TimelineTrackStyle {
  clip: string;
  accent: string;
  label: string;
  clipActive?: string;
}

export interface TimelineTheme {
  shellBackground: string;
  shellBorder: string;
  rulerBorder: string;
  rowBackground: string;
  rowBorder: string;
  gutterBackground: string;
  gutterBorder: string;
  textPrimary: string;
  textSecondary: string;
  tickText: string;
  tickMajor: string;
  tickMinor: string;
  clipBackground: string;
  clipBackgroundActive: string;
  clipBackgroundHover: string;
  clipBackgroundDragging: string;
  clipBorder: string;
  clipBorderHover: string;
  clipBorderActive: string;
  clipShadow: string;
  clipShadowHover: string;
  clipShadowActive: string;
  clipShadowDragging: string;
  handleColor: string;
  panelResizeSeam: string;
  panelResizeActive: string;
  clipRadius: string;
}

const TRACK_STYLE: TimelineTrackStyle = {
  clip: "var(--timeline-track-clip-fill)",
  clipActive: "var(--timeline-track-clip-active)",
  accent: "var(--color-accent)",
  label: "var(--timeline-track-label)",
};

// Every field reads a CSS custom property (declared in styles/theme.css)
// rather than a literal, so a host themes the timeline the same way it
// themes the rest of Studio: by overriding the token, not this object.
export const defaultTimelineTheme: TimelineTheme = {
  shellBackground: "var(--timeline-shell-bg)",
  shellBorder: "var(--timeline-shell-border)",
  rulerBorder: "var(--timeline-ruler-border)",
  rowBackground: "var(--timeline-row-bg)",
  rowBorder: "var(--timeline-row-border)",
  gutterBackground: "var(--timeline-gutter-bg)",
  gutterBorder: "var(--timeline-gutter-border)",
  textPrimary: "var(--timeline-text-primary)",
  textSecondary: "var(--timeline-text-secondary)",
  tickText: "var(--timeline-tick-text)",
  tickMajor: "var(--timeline-tick-major)",
  tickMinor: "var(--timeline-tick-minor)",
  clipBackground: "var(--timeline-clip-bg)",
  clipBackgroundActive: "var(--timeline-clip-bg-active)",
  clipBackgroundHover: "var(--timeline-clip-bg-hover)",
  clipBackgroundDragging: "var(--timeline-clip-bg-dragging)",
  clipBorder: "var(--timeline-clip-border)",
  clipBorderHover: "var(--timeline-clip-border-hover)",
  clipBorderActive: "var(--timeline-clip-border-active)",
  // Shadows stay literal: a light host still wants a dark contact shadow, so
  // these are not part of the surface/hairline/text/clip-colour theming ask.
  clipShadow: "none",
  clipShadowHover: "0 2px 8px rgba(0,0,0,0.2)",
  clipShadowActive: "0 2px 8px rgba(0,0,0,0.2), 0 0 0 1px rgba(255,255,255,0.04)",
  clipShadowDragging: "0 8px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.06)",
  handleColor: "var(--timeline-handle)",
  panelResizeSeam: "var(--timeline-resize-seam)",
  panelResizeActive: "var(--timeline-resize-active)",
  clipRadius: "var(--radius-lg)",
};

export function getTimelineTrackStyle(_tag: string): TimelineTrackStyle {
  return TRACK_STYLE;
}

export function getClipHandleOpacity({
  isHovered,
  isSelected,
  isDragging,
}: {
  isHovered: boolean;
  isSelected: boolean;
  isDragging: boolean;
}): number {
  if (isDragging) return 0.95;
  if (isSelected) return 0.82;
  if (isHovered) return 0.76;
  return 0;
}

export function getRenderedTimelineElement({
  element,
  draggedElementId,
  previewStart,
  previewTrack,
}: {
  element: TimelineElement;
  draggedElementId: string | null;
  previewStart: number | null;
  previewTrack: number | null;
}): TimelineElement {
  if (
    (element.key ?? element.id) !== draggedElementId ||
    previewStart === null ||
    previewTrack === null
  ) {
    return element;
  }
  return {
    ...element,
    start: previewStart,
    track: previewTrack,
  };
}
