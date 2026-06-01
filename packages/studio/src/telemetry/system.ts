// ---------------------------------------------------------------------------
// Browser metadata attached to every studio telemetry event.
// Mirrors `packages/cli/src/telemetry/system.ts` but uses browser APIs.
// No PII — only environment characteristics useful for product analytics.
// ---------------------------------------------------------------------------

export interface BrowserSystemMeta {
  user_agent: string;
  language: string;
  screen_width: number;
  screen_height: number;
  device_pixel_ratio: number;
  timezone_offset_minutes: number;
  is_mobile: boolean;
  studio_version: string;
}

const EMPTY_META: BrowserSystemMeta = {
  user_agent: "",
  language: "",
  screen_width: 0,
  screen_height: 0,
  device_pixel_ratio: 0,
  timezone_offset_minutes: 0,
  is_mobile: false,
  studio_version: "dev",
};

let cached: BrowserSystemMeta | null = null;

export function getBrowserSystemMeta(): BrowserSystemMeta {
  if (cached) return cached;
  // SSR / no-DOM: return zeroed meta. Cheap to detect once at module load.
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    cached = EMPTY_META;
    return cached;
  }
  const ua = navigator.userAgent;
  const screen = window.screen;
  cached = {
    user_agent: ua,
    language: navigator.language,
    screen_width: screen.width,
    screen_height: screen.height,
    device_pixel_ratio: window.devicePixelRatio,
    timezone_offset_minutes: new Date().getTimezoneOffset(),
    is_mobile: /Android|iPhone|iPad/i.test(ua),
    studio_version: typeof __STUDIO_VERSION__ !== "undefined" ? __STUDIO_VERSION__ : "dev",
  };
  return cached;
}

declare const __STUDIO_VERSION__: string;
