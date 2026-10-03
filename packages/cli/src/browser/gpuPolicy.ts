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

// `compositionRequiresWebGpu` and the launch-time WebGPU guard now live in
// @hyperframes/engine (browserManager.ts) — the shared choke point every
// buildChromeArgs caller goes through, CLI included. Re-exported here so
// existing CLI imports don't need to change their module path.
export { compositionRequiresWebGpu, assertWebGpuAdapterAvailable } from "@hyperframes/engine";

const COLOR_GRADING_ATTR_RE = new RegExp(`\\s${HF_COLOR_GRADING_ATTR}[\\s=>]`, "i");

export function compositionUsesColorGrading(html: string): boolean {
  return COLOR_GRADING_ATTR_RE.test(html);
}

const COLOR_GRADING_GPU_STALL_WARNING =
  `This composition uses ${HF_COLOR_GRADING_ATTR}, but no hardware GPU was detected, so the ` +
  "browser renders with software WebGL. Color grading's per-frame canvas readback " +
  "is far slower there and can exceed the navigation timeout. If this run is slow or " +
  "times out, raise --timeout or run on a host with a real GPU.";

// Explicit "software" is a deliberate choice; "hardware" is echoed verbatim by the engine,
// so probe "auto" (the engine's cached probe) for the real answer.
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
    // Best-effort: the real launch surfaces a genuine browser failure.
    return null;
  }
}
