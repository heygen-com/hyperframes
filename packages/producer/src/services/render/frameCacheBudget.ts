import type { EngineConfig } from "@hyperframes/engine";

/** Cache options for one of `workers` injectors that share the configured budget on the one Node heap. */
export function frameCacheOptions(
  cfg: Pick<EngineConfig, "frameDataUriCacheLimit" | "frameDataUriCacheBytesLimitMb">,
  workers: number | undefined,
): Pick<EngineConfig, "frameDataUriCacheLimit" | "frameDataUriCacheBytesLimitMb"> {
  return {
    frameDataUriCacheLimit: cfg.frameDataUriCacheLimit,
    frameDataUriCacheBytesLimitMb: Math.floor(cfg.frameDataUriCacheBytesLimitMb / (workers || 1)),
  };
}
