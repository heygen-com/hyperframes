import { resolveConfig, usesSoftwareWebGpu } from "@hyperframes/engine";

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

/** The launch config and adapter check for a local capture, honouring PRODUCER_ALLOW_SOFTWARE_WEBGPU as render does. */
export function resolveLocalWebGpu(
  browserGpuMode: ResolvedBrowserGpuMode,
  requiresWebGpu: boolean,
) {
  const gpuConfig = { browserGpuMode, allowSoftwareWebGpu: resolveConfig().allowSoftwareWebGpu };
  return { gpuConfig, softwareWebGpu: usesSoftwareWebGpu(requiresWebGpu, gpuConfig) };
}
