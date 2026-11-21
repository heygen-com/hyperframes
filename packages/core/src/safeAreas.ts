export interface SafeArea {
  label: string;
  width: number;
  height: number;
  clearBandsTopToBottom: [top: number, bottom: number, left: number, right: number][];
}

// Vertical-ad guides checked 2026-10-13: TikTok in-feed ads template (720x1280, stepped right edge
// for the action buttons), Meta's Reels ads guide (bottom 35%; top 14% and sides 6% are a conservative
// pick), Google's YouTube Shorts video ad specs (1080x1920). Platform UI varies by caption and device.
export const SOCIAL_SAFE_AREAS = {
  tiktok: {
    label: "TikTok",
    width: 720,
    height: 1280,
    clearBandsTopToBottom: [
      [160, 560, 80, 640],
      [560, 840, 80, 520],
    ],
  },
  reels: {
    label: "Instagram Reels",
    width: 100,
    height: 100,
    clearBandsTopToBottom: [[14, 65, 6, 94]],
  },
  shorts: {
    label: "YouTube Shorts",
    width: 1080,
    height: 1920,
    clearBandsTopToBottom: [[288, 1248, 48, 888]],
  },
} satisfies Record<string, SafeArea>;

export type SocialSafeArea = keyof typeof SOCIAL_SAFE_AREAS;
export const SOCIAL_SAFE_AREA_NAMES: SocialSafeArea[] = ["tiktok", "reels", "shorts"];

// Adobe Premiere default: action-safe and title-safe margins are 10% and 20% total (5% and 10% per edge).
export const ACTION_SAFE_PERCENT = 90;
export const TITLE_SAFE_PERCENT = 80;

export const SAFE_BOX_PERCENTS = [ACTION_SAFE_PERCENT, TITLE_SAFE_PERCENT] as const;

export function safeBoxInsetPercent(boxPercent: number): number {
  return (100 - boxPercent) / 2;
}
