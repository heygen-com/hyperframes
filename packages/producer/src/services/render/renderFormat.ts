export type RenderOutputFormat = "mp4" | "webm" | "mov" | "png-sequence" | "gif" | "hls";

export function outputNeedsAlpha(format: RenderOutputFormat): boolean {
  return format !== "mp4" && format !== "hls";
}

export function outputSupportsPageSideShaderCompositing(format: RenderOutputFormat): boolean {
  return format === "mp4" || format === "gif" || format === "hls";
}

/**
 * `mp4` and `hls` share the same opaque H.264/H.265 encode: identical capture
 * mode, encoder preset, and `video-only.mp4` intermediate. Only the delivery
 * container differs, and only at assemble time. Every capture/encode router
 * gate that used to test `format === "mp4"` must test this instead, or HLS
 * silently falls off the fast paths mp4 renders take.
 */
export function outputUsesH264Pipeline(format: RenderOutputFormat): boolean {
  return format === "mp4" || format === "hls";
}
