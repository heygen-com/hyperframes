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
  clip: "rgba(255,255,255,0.055)",
  clipActive: "rgba(60,230,172,0.16)",
  accent: "#3CE6AC",
  label: "rgba(255,255,255,0.5)",
};

export const defaultTimelineTheme: TimelineTheme = {
  // Near-black card surfaces: the panels sit dark while the shell canvas
  // between them is a step LIGHTER (#18181B), so the gaps read as visible
  // seams around dark cards (CapCut-style).
  shellBackground: "#0A0A0B",
  shellBorder: "rgba(255,255,255,0.05)",
  rulerBorder: "rgba(255,255,255,0.16)",
  // All track lanes use a single uniform color — one step lighter than the panel
  // surface (#0A0A0B) so lanes are visibly distinct from the ruler/shell.
  rowBackground: "#101014",
  rowBorder: "rgba(255,255,255,0.06)",
  gutterBackground: "#0E0F12",
  gutterBorder: "rgba(255,255,255,0.10)",
  textPrimary: "rgba(255,255,255,0.92)",
  textSecondary: "rgba(255,255,255,0.62)",
  tickText: "rgba(255,255,255,0.34)",
  tickMajor: "rgba(255,255,255,0.10)",
  tickMinor: "rgba(255,255,255,0.06)",
  clipBackground: "#141922",
  clipBackgroundActive: "#181e28",
  clipBorder: "rgba(255,255,255,0.10)",
  clipBorderHover: "rgba(255,255,255,0.18)",
  clipBorderActive: "rgba(255,255,255,0.24)",
  clipShadow: "none",
  clipShadowHover: "0 2px 8px rgba(0,0,0,0.2)",
  clipShadowActive: "0 2px 8px rgba(0,0,0,0.2), 0 0 0 1px rgba(255,255,255,0.04)",
  clipShadowDragging: "0 8px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.06)",
  handleColor: "rgba(255,255,255,0.2)",
  panelResizeSeam: "rgba(255,255,255,0.12)",
  panelResizeActive: "rgba(255,255,255,0.24)",
  clipRadius: "8px",
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
