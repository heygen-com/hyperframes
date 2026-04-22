export async function loadRuntimeSourceFallback(): Promise<string | null> {
  try {
    const mod = await import("@hyperframes/core");
    if (typeof mod.loadHyperframeRuntimeSource === "function") {
      return mod.loadHyperframeRuntimeSource();
    }
  } catch (err) {
    console.warn("[studio] Failed to load runtime source fallback:", err);
  }
  return null;
}
