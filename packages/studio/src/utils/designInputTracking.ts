import { trackStudioEvent } from "./studioTelemetry";

// Per-input usage telemetry for the design (inspector) panel. Both inspector UIs
// (classic PropertyPanel, flat PropertyPanelFlat) funnel their inputs through this
// one helper so usage can be ranked by input to find removal candidates. Emits the
// batched `studio:design_input` event via trackStudioEvent (opt-out-aware, never-throw).

export type DesignInputUi = "flat" | "classic";

export interface DesignInputDescriptor {
  ui: DesignInputUi;
  /** Section slug the input lives under (e.g. "style", "color-grading"). */
  section: string;
  /** Control kind: "metric" | "slider" | "select" | "segmented" | "toggle" | "color" | "text" | "button" | … */
  control: string;
  /** Input identity — the field label or CSS/GSAP property. Slugified for stable ranking. */
  name: string;
}

// Continuous controls (sliders, scrub, wheel-nudge, live-commit text) fire many
// commits per interaction. Collapse repeated fires of the same input within this
// window into one event so a single drag counts once (R4).
const COALESCE_WINDOW_MS = 600;

const lastFiredByKey = new Map<string, number>();

function now(): number {
  // performance.now() is monotonic and available in the studio runtime and jsdom.
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : 0;
}

export function slugifyDesignInput(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Test seam: clear the coalescing state between cases. */
export function __resetDesignInputThrottle(): void {
  lastFiredByKey.clear();
}

export function trackDesignInput(descriptor: DesignInputDescriptor): void {
  try {
    const section = slugifyDesignInput(descriptor.section) || "unknown";
    const name = slugifyDesignInput(descriptor.name);
    // An input with no resolvable name is useless for the removal analysis (R3).
    // Emit it anyway (so a coverage test can catch it) but under an explicit marker.
    const control = descriptor.control || "unknown";
    const key = `${descriptor.ui}:${section}:${control}:${name || "unnamed"}`;

    const t = now();
    const last = lastFiredByKey.get(key);
    if (last !== undefined && t - last < COALESCE_WINDOW_MS) return;
    lastFiredByKey.set(key, t);

    trackStudioEvent("design_input", {
      ui: descriptor.ui,
      section,
      control,
      name: name || "unnamed",
    });
  } catch {
    // Telemetry must never break the edit path.
  }
}
