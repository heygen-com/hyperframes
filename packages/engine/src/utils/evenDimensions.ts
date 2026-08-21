/**
 * Even-dimension normalization for chroma-subsampled encodes.
 *
 * libx264 / libx265 with 4:2:0 chroma subsampling (yuv420p, yuv420p10le)
 * require both width and height to be even. An odd output dimension makes the
 * encoder abort before writing a single packet:
 *
 *   [libx264] height not divisible by 2 (1080x723)
 *   Error while opening encoder ... Invalid argument
 *
 * A composition with an odd data-width / data-height (e.g. a custom 3:1 canvas
 * at 1080x723) therefore fails to encode to H.264. The fix pads the odd
 * dimension up by a single pixel inside the encode filter chain, so the
 * encoder always receives even dimensions. Padding (not scaling) means content
 * is never resampled — at most one transparent/black row or column is added at
 * the bottom-right edge.
 */

// `pad=ceil(iw/2)*2:ceil(ih/2)*2` rounds each dimension UP to the next even
// value (a no-op when already even) and keeps content at the top-left (x=0,y=0
// default), so nothing shifts. iw/ih are evaluated by FFmpeg at runtime, so
// this works whether or not the caller knows the frame size up front.
const EVEN_DIMENSION_PAD = "pad=ceil(iw/2)*2:ceil(ih/2)*2";

/**
 * Pixel formats whose chroma subsampling requires even width AND height.
 * 4:2:0 family only: yuv420p (H.264 SDR), yuv420p10le (H.265 HDR), and the
 * full-range yuvj420p Chrome screenshots arrive as. ProRes 4444
 * (yuva444p10le) and other 4:4:4 / alpha formats sample chroma per-pixel and
 * accept odd dimensions, so they are deliberately excluded — padding them
 * would needlessly distort transparent output.
 */
export function requiresEvenDimensions(pixelFormat: string): boolean {
  return pixelFormat.startsWith("yuv420") || pixelFormat.startsWith("yuvj420");
}

/**
 * Append the even-dimension pad to an FFmpeg `-vf` chain when the target pixel
 * format requires it. When both dimensions are known and already even, omit
 * the filter entirely so minimal FFmpeg builds do not need to provide `pad`.
 * Returns the chain unchanged for formats that accept odd dimensions, and
 * returns just the pad when there is no existing chain.
 */
export function withEvenDimensionPad(
  vfChain: string,
  pixelFormat: string,
  width?: number,
  height?: number,
): string {
  if (!requiresEvenDimensions(pixelFormat)) return vfChain;
  if (width !== undefined && height !== undefined && width % 2 === 0 && height % 2 === 0) {
    return vfChain;
  }
  return vfChain ? `${vfChain},${EVEN_DIMENSION_PAD}` : EVEN_DIMENSION_PAD;
}
