const ALPHA_PIX_FMT_RE = /^(?:yuva|rgba|argb|bgra|abgr|gbrap|ya|ayuv)/i;

export function pixelFormatHasAlpha(pixFmt: string | undefined): boolean {
  return pixFmt !== undefined && ALPHA_PIX_FMT_RE.test(pixFmt);
}

export interface FfprobeAlphaFields {
  pix_fmt?: string;
  tags?: Record<string, string | undefined>;
}

/** True when an ffprobe video stream carries alpha. VP8/VP9 alpha rides in a side channel:
 * ffprobe reports `yuv420p` plus an `alpha_mode=1` tag, whose casing differs across builds. */
export function videoStreamHasAlpha(stream: FfprobeAlphaFields): boolean {
  if (pixelFormatHasAlpha(stream.pix_fmt)) return true;
  return Object.entries(stream.tags ?? {}).some(
    ([key, value]) => key.toLowerCase() === "alpha_mode" && value === "1",
  );
}

/** The decoder that reads a VP8/VP9 alpha side channel; ffmpeg's native ones drop it. */
export function alphaDecoderFor(codecName: string | undefined): "libvpx-vp9" | "libvpx" | null {
  const codec = codecName?.toLowerCase();
  if (codec === "vp9") return "libvpx-vp9";
  if (codec === "vp8") return "libvpx";
  return null;
}
