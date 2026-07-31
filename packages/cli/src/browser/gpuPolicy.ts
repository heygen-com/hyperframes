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
