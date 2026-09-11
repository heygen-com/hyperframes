import { HF_COLOR_GRADING_ATTR } from "@hyperframes/core";

export type BrowserGpuMode = "auto" | "hardware" | "software";
export type ResolvedBrowserGpuMode = Exclude<BrowserGpuMode, "auto">;

export function resolveLocalBrowserGpuMode(
  browserGpuArg?: boolean,
  envMode = process.env.PRODUCER_BROWSER_GPU_MODE,
): BrowserGpuMode {
  if (browserGpuArg === true) return "hardware";
  if (browserGpuArg === false) return "software";
  if (envMode === "hardware" || envMode === "software" || envMode === "auto") return envMode;
  return "auto";
}

export async function resolveCaptureBrowserGpuMode(
  requestedMode: BrowserGpuMode,
  chromePath?: string,
): Promise<ResolvedBrowserGpuMode> {
  const { resolveBrowserGpuMode } = await import("@hyperframes/engine");
  return resolveBrowserGpuMode(requestedMode, { chromePath });
}

export function compositionRequiresWebGpu(html: string): boolean {
  const compositionRoot = html.match(
    /<[^>]*\bdata-composition-id(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?[^>]*>/i,
  );
  return compositionRoot ? /\bdata-requires-webgpu(?:\s|=|>)/i.test(compositionRoot[0]) : false;
}

export function assertWebGpuRequirement(
  html: string,
  requestedMode: BrowserGpuMode,
  resolvedMode: ResolvedBrowserGpuMode,
): void {
  if (requestedMode !== "auto" || resolvedMode !== "software" || !compositionRequiresWebGpu(html)) {
    return;
  }
  throw new Error(
    "This composition declares data-requires-webgpu, but browser GPU auto-detection found no hardware GPU. " +
      "Run on a WebGPU-capable host or set PRODUCER_BROWSER_GPU_MODE=hardware " +
      "(or pass --browser-gpu on commands that support it) to require hardware explicitly; " +
      "use --no-browser-gpu only when intentionally testing the composition's software fallback.",
  );
}

export function compositionUsesColorGrading(html: string): boolean {
  const escapedAttr = HF_COLOR_GRADING_ATTR.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  return new RegExp(`\\s${escapedAttr}(?:\\s|=|>)`, "i").test(html);
}

const COLOR_GRADING_GPU_STALL_WARNING =
  `This composition uses ${HF_COLOR_GRADING_ATTR}, but no hardware GPU was detected — ` +
  "the browser will render on the SwiftShader/software WebGL fallback. Color grading's " +
  "per-element canvas readback has no fast path under software WebGL: it has been measured " +
  "at roughly 40x slower than an ungraded composition, which is easily enough to exceed the " +
  "navigation/render-ready timeout, or to make check/render painfully slow even once past it. " +
  "If this run is unexpectedly slow or times out, try a much larger --timeout, run on a host " +
  "with a real GPU, or preprocess to monochrome derivatives with grading intensity 0 before " +
  "capturing with --browser-gpu to skip the expensive per-frame grading pass entirely.";

/**
 * Preflight for a known SwiftShader limitation (not a hyperframes bug): a
 * per-element color-grading canvas pays a synchronous GPU-stall readback cost
 * that software WebGL has no fast path for, ~40x slower than an ungraded
 * composition in measured practice. `requestedMode: "software"` is a
 * deliberate, already-informed choice and is not warned about; `"auto"` /
 * `"hardware"` both expect speed, so a silent fallback to software there is
 * exactly the surprise this call is meant to catch before capture starts.
 * Reuses `resolveCaptureBrowserGpuMode`'s cached probe (forcing `"auto"` to
 * get the ground-truth answer even when the caller requested `"hardware"`,
 * which always reports back `"hardware"` verbatim) — resolved against the
 * same `ensureBrowser()` executable path a subsequent real launch will use,
 * so this doesn't seed the shared cache with a different browser's probe.
 * Best-effort: any probe failure here is treated as "nothing to warn about"
 * rather than failing the caller — the real launch will surface a genuine
 * browser problem on its own.
 */
export async function detectColorGradingGpuStallRisk(
  html: string,
  requestedMode: BrowserGpuMode,
): Promise<string | null> {
  if (requestedMode === "software" || !compositionUsesColorGrading(html)) return null;
  try {
    const { ensureBrowser } = await import("./manager.js");
    const browser = await ensureBrowser();
    const actualMode = await resolveCaptureBrowserGpuMode("auto", browser.executablePath);
    return actualMode === "software" ? COLOR_GRADING_GPU_STALL_WARNING : null;
  } catch {
    return null;
  }
}
