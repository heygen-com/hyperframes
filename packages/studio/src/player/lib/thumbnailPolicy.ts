export type ThumbnailMode = "adaptive" | "hidden";
export type ThumbnailRuntimePolicy = "follow-preference" | "force-hidden" | "legacy-default";

const rawPolicy = import.meta.env.VITE_STUDIO_TIMELINE_THUMBNAIL_POLICY;

export const STUDIO_THUMBNAIL_RUNTIME_POLICY: ThumbnailRuntimePolicy =
  rawPolicy === "force-hidden" || rawPolicy === "legacy-default" ? rawPolicy : "follow-preference";

export function defaultThumbnailMode(
  storedMode: ThumbnailMode | undefined,
  policy: ThumbnailRuntimePolicy = STUDIO_THUMBNAIL_RUNTIME_POLICY,
): ThumbnailMode {
  return storedMode ?? (policy === "legacy-default" ? "hidden" : "adaptive");
}

export function effectiveThumbnailMode(
  preferredMode: ThumbnailMode,
  policy: ThumbnailRuntimePolicy = STUDIO_THUMBNAIL_RUNTIME_POLICY,
): ThumbnailMode {
  return policy === "force-hidden" ? "hidden" : preferredMode;
}
