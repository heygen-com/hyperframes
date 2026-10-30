const SAFE_RENDER_ERROR_CODES = new Set<string>([
  "ASSET_MEDIA_TYPE_MISMATCH",
  "HEIF_IMAGE_CONVERSION_FAILED",
  "HEIF_TOOL_UNAVAILABLE",
  "NOT_MEDIA_PAYLOAD",
  "INVALID_VIDEO_METADATA",
  "VIDEO_SOURCE_UNRENDERABLE",
  "VIDEO_EXTRACTION_FAILED",
  "ENCODER_INTERRUPTED",
  "RENDER_TOO_SLOW",
  "RENDER_STAGE_STALLED",
]);

/**
 * Preserve only bounded producer error codes across JSON/SSE. Never derive a
 * code from the message: it may contain local paths or signed source URLs.
 */
export function extractSafeRenderErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = error.code;
  return typeof code === "string" && SAFE_RENDER_ERROR_CODES.has(code) ? code : undefined;
}
