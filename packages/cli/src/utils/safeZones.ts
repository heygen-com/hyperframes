import type { LayoutRect } from "./layoutAudit.js";

export type SafeZoneEdge = "left" | "top" | "right" | "bottom";

interface SafeArea {
  label: string;
  width: number;
  height: number;
  /** The clear area as horizontal bands, top to bottom: [top, bottom, left, right]. */
  bands: [number, number, number, number][];
}

// Vertical-ad guides checked 2026-10-13: TikTok in-feed ads template (720x1280, stepped right edge
// for the action buttons), Meta's Reels ads guide (bottom 35%; top 14% and sides 6% are a conservative
// pick), Google's YouTube Shorts video ad specs (1080x1920). Platform UI varies by caption and device.
export const SAFE_AREAS = {
  tiktok: {
    label: "TikTok",
    width: 720,
    height: 1280,
    bands: [
      [160, 560, 80, 640],
      [560, 840, 80, 520],
    ],
  },
  reels: { label: "Instagram Reels", width: 100, height: 100, bands: [[14, 65, 6, 94]] },
  shorts: { label: "YouTube Shorts", width: 1080, height: 1920, bands: [[288, 1248, 48, 888]] },
} satisfies Record<string, SafeArea>;

export type SafeZonePlatform = keyof typeof SAFE_AREAS;
export const SAFE_ZONE_PLATFORMS: SafeZonePlatform[] = ["tiktok", "reels", "shorts"];

export function isNineBySixteen(canvas: { width: number; height: number }): boolean {
  return canvas.height > 0 && Math.abs(canvas.width / canvas.height - 9 / 16) < 0.01;
}

export function safeZoneEdgesCrossed(
  box: LayoutRect,
  canvas: { width: number; height: number },
  platform: SafeZonePlatform,
): SafeZoneEdge[] {
  const area: SafeArea = SAFE_AREAS[platform];
  const x = (value: number) => (value / area.width) * canvas.width;
  const y = (value: number) => (value / area.height) * canvas.height;
  const edges = new Set<SafeZoneEdge>();
  const first = area.bands[0];
  const last = area.bands.at(-1);
  if (first && box.top < y(first[0])) edges.add("top");
  if (last && box.bottom > y(last[1])) edges.add("bottom");
  for (const [top, bottom, left, right] of area.bands) {
    if (box.bottom <= y(top) || box.top >= y(bottom)) continue;
    if (box.left < x(left)) edges.add("left");
    if (box.right > x(right)) edges.add("right");
  }
  return (["left", "top", "right", "bottom"] as const).filter((edge) => edges.has(edge));
}
