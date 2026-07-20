export type ThumbnailMode = "adaptive" | "hidden";
export type ThumbnailRuntimePolicy = "follow-preference" | "force-hidden" | "legacy-default";

const rawPolicy = import.meta.env.VITE_STUDIO_TIMELINE_THUMBNAIL_POLICY;

const studioThumbnailRuntimePolicy: ThumbnailRuntimePolicy =
  rawPolicy === "force-hidden" || rawPolicy === "legacy-default" ? rawPolicy : "follow-preference";

export function defaultThumbnailMode(
  storedMode: ThumbnailMode | undefined,
  policy: ThumbnailRuntimePolicy = studioThumbnailRuntimePolicy,
): ThumbnailMode {
  return storedMode ?? (policy === "legacy-default" ? "hidden" : "adaptive");
}

export function effectiveThumbnailMode(
  preferredMode: ThumbnailMode,
  policy: ThumbnailRuntimePolicy = studioThumbnailRuntimePolicy,
): ThumbnailMode {
  return policy === "force-hidden" ? "hidden" : preferredMode;
}
