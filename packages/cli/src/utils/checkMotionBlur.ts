import type { Page } from "puppeteer-core";
import type { CheckSeverity } from "./checkTypes.js";

/** What the core runtime's `__hfMotionBlur.probe()` reports for a root that asked for blur. */
export interface MotionBlurProbe {
  state: "on" | "off";
  tier: "capture" | "filter" | null;
  reason: string | null;
  reasonCode: string | null;
  movers: number;
}

export interface MotionBlurDraft {
  code: string;
  severity: CheckSeverity;
  message: string;
  fixHint: string;
  time: number;
}

const OFF_HINTS: Record<string, string> = {
  "accelerated-canvas":
    "html-in-canvas captures WebGL/WebGPU frozen, in sub-compositions too: render that effect separately or flatten it out of the page, or drop data-motion-blur on this composition",
  "backface-visibility":
    "backface-visibility: hidden inside a 3D transform is drawn mirrored; avoid the 3D flip or drop motion blur",
  "iframe-in-root":
    "move the <iframe>, <object>, <embed> or custom element out of the composition root (each is re-initialised when blur wraps the root), or drop motion blur",
  "root-transform": "animate a child element instead of the composition root, or drop motion blur",
  "root-opacity": "animate a child element instead of the composition root, or drop motion blur",
  "root-blend-mode":
    "set mix-blend-mode on a child element instead of the composition root, or drop motion blur",
  "nested-capture-canvas":
    "remove the inner <canvas layoutsubtree> / content=drawable, or drop motion blur",
};
const CHOSEN = new Set(["translation-only", "tier-attribute"]);
const GENERIC_OFF_HINT = "remove what the reason names, or drop data-motion-blur";

const ASKED = 'data-motion-blur="on" is set but';

/** The findings for one probe; null (no opt-in, or nothing to read) gives none. */
export function motionBlurDrafts(probe: MotionBlurProbe | null): MotionBlurDraft[] {
  if (!probe) return [];
  if (probe.reasonCode === "unsupported-browser") {
    return [
      {
        code: "motion_blur_unverified",
        severity: "info",
        message: `${ASKED} the check browser cannot run capture blur, so it was drawn with the filter fallback`,
        fixHint:
          "the check browser has no html-in-canvas (drawElementImage); render once to see how capture blur looks",
        time: 0,
      },
    ];
  }
  if (probe.state === "off") {
    return [
      {
        code: "motion_blur_off",
        severity: "warning",
        message: `${ASKED} blur is off: ${probe.reason ?? "unknown reason"}`,
        fixHint: OFF_HINTS[probe.reasonCode ?? ""] ?? GENERIC_OFF_HINT,
        time: 0,
      },
    ];
  }
  if (probe.tier === "filter" && probe.movers > 0 && !CHOSEN.has(probe.reasonCode ?? "")) {
    return [
      {
        code: "motion_blur_filter_fallback",
        severity: "info",
        message: `data-motion-blur="on" is drawn by the filter fallback: ${probe.reason ?? "capture blur cannot run here"}`,
        fixHint: `the fallback smears movement but only softens zoom and rotation; ${OFF_HINTS[probe.reasonCode ?? ""] ?? GENERIC_OFF_HINT}`,
        time: 0,
      },
    ];
  }
  if (probe.movers === 0) {
    return [
      {
        code: "motion_blur_no_movers",
        severity: "info",
        message: `${ASKED} nothing in the composition moves fast enough to blur, so it has no effect`,
        fixHint:
          'animate an element\'s transform or position by 2+ px per frame; if the motion is set from a timeline callback (onUpdate, render(t)), add data-motion-blur-events="on"; otherwise drop data-motion-blur',
        time: 0,
      },
    ];
  }
  return [];
}

// Serialized into the page; the guards must stay one function.
// fallow-ignore-next-line complexity
export function readMotionBlurProbe(): MotionBlurProbe | null {
  const api: unknown = Reflect.get(window, "__hfMotionBlur");
  if (typeof api !== "object" || api === null) return null;
  const probe: unknown = Reflect.get(api, "probe");
  if (typeof probe !== "function") return null;
  const report: unknown = Reflect.apply(probe, api, []);
  if (typeof report !== "object" || report === null) return null;
  const reason: unknown = Reflect.get(report, "reason");
  const code: unknown = Reflect.get(report, "reasonCode");
  const movers: unknown = Reflect.get(report, "movers");
  const tier: unknown = Reflect.get(report, "tier");
  const suspend: unknown = Reflect.get(api, "suspend");
  if (typeof suspend === "function") Reflect.apply(suspend, api, []);
  return {
    state: Reflect.get(report, "state") === "off" ? "off" : "on",
    tier: tier === "capture" || tier === "filter" ? tier : null,
    reason: typeof reason === "string" ? reason : null,
    reasonCode: typeof code === "string" ? code : null,
    movers: typeof movers === "number" ? movers : 0,
  };
}

/** Ask the page to decide blur now. The runtime exposes the global only for a root that asked for blur. */
export async function collectMotionBlurDrafts(page: Page): Promise<MotionBlurDraft[]> {
  const probe = await page.evaluate(readMotionBlurProbe).catch(() => null);
  return motionBlurDrafts(probe);
}

/** The runtime also warns on the console when a scan turns blur off; the finding already says it. */
export function dropMotionBlurConsoleEcho<T extends { code: string; message: string }>(
  drafts: T[],
  found: MotionBlurDraft[],
): T[] {
  if (found.length === 0) return drafts;
  return drafts.filter(
    (d) => !(d.code === "console_warning" && d.message.startsWith("[motion-blur] off:")),
  );
}
