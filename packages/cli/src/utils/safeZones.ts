import {
  SOCIAL_SAFE_AREAS,
  TITLE_SAFE_PERCENT,
  safeBoxInsetPercent,
  type SafeArea,
  type SocialSafeArea,
} from "@hyperframes/core/safe-areas";
import type { LayoutRect } from "./layoutAudit.js";

export type SafeZone = SocialSafeArea | "standard";
export type SafeZoneEdge = "left" | "top" | "right" | "bottom";

const TITLE_INSET = safeBoxInsetPercent(TITLE_SAFE_PERCENT);
const SAFE_AREAS: Record<SafeZone, SafeArea> = {
  ...SOCIAL_SAFE_AREAS,
  standard: {
    label: "title-safe margins",
    width: 100,
    height: 100,
    clearBandsTopToBottom: [[TITLE_INSET, 100 - TITLE_INSET, TITLE_INSET, 100 - TITLE_INSET]],
  },
};

export function safeZoneLabel(zone: SafeZone): string {
  return SAFE_AREAS[zone].label;
}

/** The social areas only describe 9:16 frames; title-safe margins fit any frame. */
export function safeZonesFor(zones: SafeZone[], canvas: { width: number; height: number }) {
  const nineBySixteen = canvas.height > 0 && Math.abs(canvas.width / canvas.height - 9 / 16) < 0.01;
  return zones.filter((zone) => zone === "standard" || nineBySixteen);
}

export function safeZoneEdgesCrossed(
  box: LayoutRect,
  canvas: { width: number; height: number },
  zone: SafeZone,
): SafeZoneEdge[] {
  const area = SAFE_AREAS[zone];
  const x = (value: number) => (value / area.width) * canvas.width;
  const y = (value: number) => (value / area.height) * canvas.height;
  const edges = new Set<SafeZoneEdge>();
  const first = area.clearBandsTopToBottom[0];
  const last = area.clearBandsTopToBottom.at(-1);
  if (first && box.top < y(first[0])) edges.add("top");
  if (last && box.bottom > y(last[1])) edges.add("bottom");
  for (const [top, bottom, left, right] of area.clearBandsTopToBottom) {
    if (box.bottom <= y(top) || box.top >= y(bottom)) continue;
    if (box.left < x(left)) edges.add("left");
    if (box.right > x(right)) edges.add("right");
  }
  return (["left", "top", "right", "bottom"] as const).filter((edge) => edges.has(edge));
}
