export type ResolvedBrowserGpuMode = "software" | "hardware";

/**
 * Native video surfaces can need Chrome's beyond-viewport compositor on
 * hardware-accelerated captures, but that path is a full-surface software
 * re-rasterization tax on SwiftShader/CPU render hosts.
 */
export function resolveVideoCaptureBeyondViewport(
  videoCount: number,
  browserGpuMode: ResolvedBrowserGpuMode,
): boolean | undefined {
  if (videoCount <= 0) return undefined;
  return browserGpuMode === "hardware";
}
