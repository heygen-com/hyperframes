/**
 * Alpha Blit — in-memory PNG decode + alpha compositing over rgb48le HDR frames.
 *
 * Replaces per-frame FFmpeg spawns for the two-pass HDR compositing path.
 * Uses only Node.js built-ins (zlib) — no additional dependencies.
 */

import { inflateSync } from "zlib";

// ── PNG decoder ───────────────────────────────────────────────────────────────

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Shared PNG chunk parsing + filter reconstruction.
 *
 * Verifies the PNG signature, iterates chunks to collect IHDR metadata and IDAT
 * payloads, decompresses with zlib, and reconstructs all 5 PNG filter types.
 *
 * Returns the defiltered pixel bytes (no filter-type prefix bytes) along with
 * IHDR fields so callers can convert to their target pixel format.
 */
function decodePngRaw(
  buf: Buffer,
  caller: string,
): { width: number; height: number; bitDepth: number; colorType: number; rawPixels: Buffer } {
  // Verify PNG signature
  if (
    buf[0] !== 137 ||
    buf[1] !== 80 ||
    buf[2] !== 78 ||
    buf[3] !== 71 ||
    buf[4] !== 13 ||
    buf[5] !== 10 ||
    buf[6] !== 26 ||
    buf[7] !== 10
  ) {
    throw new Error(`${caller}: not a PNG file`);
  }

  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let sawIhdr = false;
  const idatChunks: Buffer[] = [];

  while (pos + 12 <= buf.length) {
    const chunkLen = buf.readUInt32BE(pos);
    const chunkType = buf.toString("ascii", pos + 4, pos + 8);
    const chunkData = buf.subarray(pos + 8, pos + 8 + chunkLen);

    if (chunkType === "IHDR") {
      width = chunkData.readUInt32BE(0);
      height = chunkData.readUInt32BE(4);
      bitDepth = chunkData[8] ?? 0;
      colorType = chunkData[9] ?? 0;
      interlace = chunkData[12] ?? 0;
      sawIhdr = true;
    } else if (chunkType === "IDAT") {
      idatChunks.push(Buffer.from(chunkData));
    } else if (chunkType === "IEND") {
      break;
    }

    pos += 12 + chunkLen; // length(4) + type(4) + data(chunkLen) + crc(4)
  }

  if (!sawIhdr) {
    throw new Error(`${caller}: PNG missing IHDR chunk`);
  }
  if (colorType !== 2 && colorType !== 6) {
    throw new Error(`${caller}: unsupported color type ${colorType} (expected 2=RGB or 6=RGBA)`);
  }
  if (interlace !== 0) {
    throw new Error(
      `${caller}: Adam7-interlaced PNGs are not supported (interlace method ${interlace})`,
    );
  }

  // Bytes per pixel: channels x bytes-per-channel
  const channels = colorType === 6 ? 4 : 3;
  const bpp = channels * (bitDepth / 8);
  const stride = width * bpp;

  const compressed = Buffer.concat(idatChunks);
  const decompressed = inflateSync(compressed);

  // Reconstruct filtered rows into a flat pixel buffer (no filter bytes)
  const rawPixels = Buffer.allocUnsafe(height * stride);
  const prevRow = new Uint8Array(stride);
  const currRow = new Uint8Array(stride);

  let srcPos = 0;

  for (let y = 0; y < height; y++) {
    const filterType = decompressed[srcPos++] ?? 0;
    const rawRow = decompressed.subarray(srcPos, srcPos + stride);
    srcPos += stride;

    switch (filterType) {
      case 0: // None
        currRow.set(rawRow);
        break;
      case 1: // Sub
        for (let x = 0; x < stride; x++) {
          currRow[x] = ((rawRow[x] ?? 0) + (x >= bpp ? (currRow[x - bpp] ?? 0) : 0)) & 0xff;
        }
        break;
      case 2: // Up
        for (let x = 0; x < stride; x++) {
          currRow[x] = ((rawRow[x] ?? 0) + (prevRow[x] ?? 0)) & 0xff;
        }
        break;
      case 3: // Average
        for (let x = 0; x < stride; x++) {
          const left = x >= bpp ? (currRow[x - bpp] ?? 0) : 0;
          const up = prevRow[x] ?? 0;
          currRow[x] = ((rawRow[x] ?? 0) + Math.floor((left + up) / 2)) & 0xff;
        }
        break;
      case 4: // Paeth
        for (let x = 0; x < stride; x++) {
          const left = x >= bpp ? (currRow[x - bpp] ?? 0) : 0;
          const up = prevRow[x] ?? 0;
          const upLeft = x >= bpp ? (prevRow[x - bpp] ?? 0) : 0;
          currRow[x] = ((rawRow[x] ?? 0) + paeth(left, up, upLeft)) & 0xff;
        }
        break;
      default:
        throw new Error(`${caller}: unknown filter type ${filterType} at row ${y}`);
    }

    rawPixels.set(currRow, y * stride);
    prevRow.set(currRow);
  }

  return { width, height, bitDepth, colorType, rawPixels };
}

/**
 * Decode a PNG buffer to raw RGBA pixel data (8-bit per channel).
 *
 * Supports color type 6 (RGBA) and color type 2 (RGB) at 8-bit depth,
 * non-interlaced. Chrome's Page.captureScreenshot always emits this format.
 *
 * Returns a Uint8Array of width*height*4 bytes in RGBA order.
 */
export function decodePng(buf: Buffer): { width: number; height: number; data: Uint8Array } {
  const { width, height, bitDepth, colorType, rawPixels } = decodePngRaw(buf, "decodePng");

  if (bitDepth !== 8) {
    throw new Error(`decodePng: unsupported bit depth ${bitDepth} (expected 8)`);
  }

  const output = new Uint8Array(width * height * 4);

  if (colorType === 6) {
    // RGBA — copy directly
    output.set(rawPixels);
  } else {
    // RGB → RGBA: set alpha to 255
    for (let i = 0; i < width * height; i++) {
      output[i * 4 + 0] = rawPixels[i * 3 + 0] ?? 0;
      output[i * 4 + 1] = rawPixels[i * 3 + 1] ?? 0;
      output[i * 4 + 2] = rawPixels[i * 3 + 2] ?? 0;
      output[i * 4 + 3] = 255;
    }
  }

  return { width, height, data: output };
}

// ── 16-bit PNG decoder ────────────────────────────────────────────────────────

/**
 * Decode a 16-bit RGB PNG (from FFmpeg) to an rgb48le Buffer.
 *
 * FFmpeg's `-pix_fmt rgb48le -c:v png` produces 16-bit RGB PNGs.
 * PNG stores 16-bit values in big-endian; this function swaps to little-endian
 * for the streaming encoder's rgb48le input format.
 *
 * Supports colorType 2 (RGB) and 6 (RGBA) at 16-bit depth, non-interlaced.
 */
export function decodePngToRgb48le(buf: Buffer): { width: number; height: number; data: Buffer } {
  const { width, height, bitDepth, colorType, rawPixels } = decodePngRaw(buf, "decodePngToRgb48le");

  if (bitDepth !== 16) {
    throw new Error(`decodePngToRgb48le: unsupported bit depth ${bitDepth} (expected 16)`);
  }

  // 16-bit: 2 bytes per channel. RGB=6 bytes/pixel, RGBA=8 bytes/pixel
  const bpp = colorType === 6 ? 8 : 6;

  // Output: rgb48le = 3 channels x 2 bytes (LE) = 6 bytes/pixel
  const output = Buffer.allocUnsafe(width * height * 6);

  for (let y = 0; y < height; y++) {
    const dstBase = y * width * 6;
    const srcRowBase = y * width * bpp;
    for (let x = 0; x < width; x++) {
      const srcBase = srcRowBase + x * bpp;
      // PNG stores 16-bit as big-endian: [high, low]. Swap to little-endian: [low, high].
      output[dstBase + x * 6 + 0] = rawPixels[srcBase + 1] ?? 0; // R low
      output[dstBase + x * 6 + 1] = rawPixels[srcBase + 0] ?? 0; // R high
      output[dstBase + x * 6 + 2] = rawPixels[srcBase + 3] ?? 0; // G low
      output[dstBase + x * 6 + 3] = rawPixels[srcBase + 2] ?? 0; // G high
      output[dstBase + x * 6 + 4] = rawPixels[srcBase + 5] ?? 0; // B low
      output[dstBase + x * 6 + 5] = rawPixels[srcBase + 4] ?? 0; // B high
    }
  }

  return { width, height, data: output };
}

// ── sRGB → HDR color conversion ───────────────────────────────────────────────

/**
 * Build a 256-entry LUT: sRGB 8-bit value → HDR 16-bit signal value.
 *
 * Pipeline per channel: sRGB EOTF (decode gamma) → linear → HDR OETF → 16-bit.
 *
 * ## Convention
 *
 * "Linear" here means **scene light in [0, 1] relative to SDR reference white**
 * (not absolute nits). The HLG branch applies the OETF directly — no OOTF (no
 * gamma 1.2 scene→display conversion). This is the right choice for DOM
 * overlays that will be composited ON TOP of HLG video pixels (which are
 * already in HLG signal space); we need the overlay to sit in the same space
 * as what it’s blending onto. Applying the OOTF here would double-apply it
 * when the HDR video already carries scene-light semantics.
 *
 * For PQ, SDR white is placed at 203 nits per ITU-R BT.2408 ("SDR white"
 * reference level) and normalized against 10,000-nit peak. This lets SDR
 * content (text, UI) sit at the conventional SDR-white brightness within a
 * PQ frame rather than at peak brightness.
 *
 * Note: converts the transfer function but not the color primaries (bt709 →
 * bt2020). For neutral/near-neutral content (text, UI) the gamut difference
 * is negligible.
 */
function buildSrgbToSignalLut(transfer: "hlg" | "pq" | "srgb"): Uint16Array {
  const lut = new Uint16Array(256);

  // HLG OETF constants (Rec. 2100)
  const hlgA = 0.17883277;
  const hlgB = 1 - 4 * hlgA;
  const hlgC = 0.5 - hlgA * Math.log(4 * hlgA);

  // PQ (SMPTE 2084) OETF constants
  const pqM1 = 0.1593017578125;
  const pqM2 = 78.84375;
  const pqC1 = 0.8359375;
  const pqC2 = 18.8515625;
  const pqC3 = 18.6875;
  const pqMaxNits = 10000.0;
  const sdrNits = 203.0;

  for (let i = 0; i < 256; i++) {
    if (transfer === "srgb") {
      lut[i] = i * 257;
      continue;
    }

    // sRGB EOTF: signal → linear (range 0–1, relative to SDR white)
    const v = i / 255;
    const linear = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);

    let signal: number;
    if (transfer === "hlg") {
      signal =
        linear <= 1 / 12 ? Math.sqrt(3 * linear) : hlgA * Math.log(12 * linear - hlgB) + hlgC;
    } else {
      // PQ OETF: linear light (in SDR nits) → PQ signal
      const Lp = Math.max(0, (linear * sdrNits) / pqMaxNits);
      const Lm1 = Math.pow(Lp, pqM1);
      signal = Math.pow((pqC1 + pqC2 * Lm1) / (1.0 + pqC3 * Lm1), pqM2);
    }

    lut[i] = Math.min(65535, Math.round(signal * 65535));
  }

  return lut;
}

const SRGB_TO_SRGB_16 = buildSrgbToSignalLut("srgb");
const SRGB_TO_HLG = buildSrgbToSignalLut("hlg");
const SRGB_TO_PQ = buildSrgbToSignalLut("pq");

/** Select the correct sRGB→HDR LUT for the given transfer function. */
function getSrgbToSignalLut(transfer: "hlg" | "pq" | "srgb"): Uint16Array {
  if (transfer === "pq") return SRGB_TO_PQ;
  if (transfer === "hlg") return SRGB_TO_HLG;
  return SRGB_TO_SRGB_16;
}

// ── Alpha compositing ─────────────────────────────────────────────────────────

/**
 * Alpha-composite a DOM RGBA overlay (8-bit sRGB) onto an HDR canvas
 * (rgb48le) in-place.
 *
 * DOM pixels are converted from sRGB to the target HDR signal space (HLG or PQ)
 * before blending so the composited output is uniformly encoded. Without this
 * conversion, sRGB content appears orange/washed in HDR playback.
 *
 * @param domRgba   Raw RGBA pixel data from decodePng() — width*height*4 bytes
 * @param canvas    HDR canvas in rgb48le format — width*height*6 bytes, mutated in-place
 * @param width     Canvas width in pixels
 * @param height    Canvas height in pixels
 * @param transfer  HDR transfer function — selects the correct sRGB→HDR LUT
 */
export function blitRgba8OverRgb48le(
  domRgba: Uint8Array,
  canvas: Buffer,
  width: number,
  height: number,
  transfer: "hlg" | "pq" | "srgb" = "hlg",
): void {
  const pixelCount = width * height;
  const lut = getSrgbToSignalLut(transfer);

  for (let i = 0; i < pixelCount; i++) {
    const da = domRgba[i * 4 + 3] ?? 0;

    if (da === 0) {
      continue;
    } else if (da === 255) {
      const r16 = lut[domRgba[i * 4 + 0] ?? 0] ?? 0;
      const g16 = lut[domRgba[i * 4 + 1] ?? 0] ?? 0;
      const b16 = lut[domRgba[i * 4 + 2] ?? 0] ?? 0;
      canvas.writeUInt16LE(r16, i * 6);
      canvas.writeUInt16LE(g16, i * 6 + 2);
      canvas.writeUInt16LE(b16, i * 6 + 4);
    } else {
      const alpha = da / 255;
      const invAlpha = 1 - alpha;

      const hdrR = (canvas[i * 6 + 0] ?? 0) | ((canvas[i * 6 + 1] ?? 0) << 8);
      const hdrG = (canvas[i * 6 + 2] ?? 0) | ((canvas[i * 6 + 3] ?? 0) << 8);
      const hdrB = (canvas[i * 6 + 4] ?? 0) | ((canvas[i * 6 + 5] ?? 0) << 8);

      const domR = lut[domRgba[i * 4 + 0] ?? 0] ?? 0;
      const domG = lut[domRgba[i * 4 + 1] ?? 0] ?? 0;
      const domB = lut[domRgba[i * 4 + 2] ?? 0] ?? 0;

      canvas.writeUInt16LE(Math.round(domR * alpha + hdrR * invAlpha), i * 6);
      canvas.writeUInt16LE(Math.round(domG * alpha + hdrG * invAlpha), i * 6 + 2);
      canvas.writeUInt16LE(Math.round(domB * alpha + hdrB * invAlpha), i * 6 + 4);
    }
  }
}

// ── Rounded-rectangle mask ───────────────────────────────────────────────────

/** Anti-aliased alpha for a point at distance `dist` from a corner circle of radius `r`. */
function cornerAlpha(px: number, py: number, cx: number, cy: number, r: number): number {
  const dx = px - cx;
  const dy = py - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > r + 0.5) return 0;
  if (dist > r - 0.5) return r + 0.5 - dist;
  return 1;
}

/**
 * Compute the alpha (0.0–1.0) for a point inside a rounded rectangle.
 * Returns 1.0 for interior pixels, 0.0 for exterior, and a smooth
 * transition at the corner edges (1px anti-aliasing).
 *
 * @param px     X coordinate (continuous, e.g. pixel center or subpixel)
 * @param py     Y coordinate
 * @param w      Rectangle width
 * @param h      Rectangle height
 * @param radii  Corner radii [topLeft, topRight, bottomRight, bottomLeft]
 */
export function roundedRectAlpha(
  px: number,
  py: number,
  w: number,
  h: number,
  radii: [number, number, number, number],
): number {
  const [tl, tr, br, bl] = radii;
  if (px < tl && py < tl) return cornerAlpha(px, py, tl, tl, tl);
  if (px >= w - tr && py < tr) return cornerAlpha(px, py, w - tr, tr, tr);
  if (px >= w - br && py >= h - br) return cornerAlpha(px, py, w - br, h - br, br);
  if (px < bl && py >= h - bl) return cornerAlpha(px, py, bl, h - bl, bl);
  return 1;
}

// ── Positioned HDR region copy ────────────────────────────────────────────────

/**
 * Copy a rectangular region of an rgb48le source onto an rgb48le canvas
 * at position (dx, dy). Clips to canvas bounds. Optional opacity blending
 * (0.0–1.0) over existing canvas content.
 *
 * @param canvas       Destination rgb48le buffer (canvasWidth * canvasHeight * 6 bytes)
 * @param source       Source rgb48le buffer (sw * sh * 6 bytes)
 * @param dx           Destination X offset on canvas
 * @param dy           Destination Y offset on canvas
 * @param sw           Source width in pixels
 * @param sh           Source height in pixels
 * @param canvasWidth  Canvas width in pixels (needed for stride calculation)
 * @param canvasHeight Canvas height in pixels (used to clip the destination region)
 * @param opacity      Optional opacity 0.0–1.0 (default 1.0 = fully opaque copy)
 */
export function blitRgb48leRegion(
  canvas: Buffer,
  source: Buffer,
  dx: number,
  dy: number,
  sw: number,
  sh: number,
  canvasWidth: number,
  canvasHeight: number,
  opacity?: number,
  borderRadius?: [number, number, number, number],
): void {
  if (sw <= 0 || sh <= 0) return;

  const op = opacity ?? 1.0;
  if (op <= 0) return;

  const x0 = Math.max(0, dx);
  const y0 = Math.max(0, dy);
  const x1 = Math.min(canvasWidth, dx + sw);
  const y1 = Math.min(canvasHeight, dy + sh);
  if (x0 >= x1 || y0 >= y1) return;

  const clippedW = x1 - x0;
  const srcOffsetX = x0 - dx;
  const srcOffsetY = y0 - dy;

  const hasMask = borderRadius !== undefined;

  if (op >= 0.999 && !hasMask) {
    for (let y = 0; y < y1 - y0; y++) {
      const srcRowOff = ((srcOffsetY + y) * sw + srcOffsetX) * 6;
      const dstRowOff = ((y0 + y) * canvasWidth + x0) * 6;
      source.copy(canvas, dstRowOff, srcRowOff, srcRowOff + clippedW * 6);
    }
  } else if (!hasMask) {
    const invOp = 1 - op;
    for (let y = 0; y < y1 - y0; y++) {
      let srcOff = ((srcOffsetY + y) * sw + srcOffsetX) * 6;
      let dstOff = ((y0 + y) * canvasWidth + x0) * 6;
      for (let x = 0; x < clippedW; x++) {
        const sr = source[srcOff]! | (source[srcOff + 1]! << 8);
        const sg = source[srcOff + 2]! | (source[srcOff + 3]! << 8);
        const sb = source[srcOff + 4]! | (source[srcOff + 5]! << 8);
        const dr = canvas[dstOff]! | (canvas[dstOff + 1]! << 8);
        const dg = canvas[dstOff + 2]! | (canvas[dstOff + 3]! << 8);
        const db = canvas[dstOff + 4]! | (canvas[dstOff + 5]! << 8);

        const r = (sr * op + dr * invOp + 0.5) | 0;
        const g = (sg * op + dg * invOp + 0.5) | 0;
        const b = (sb * op + db * invOp + 0.5) | 0;
        canvas[dstOff] = r & 0xff;
        canvas[dstOff + 1] = r >>> 8;
        canvas[dstOff + 2] = g & 0xff;
        canvas[dstOff + 3] = g >>> 8;
        canvas[dstOff + 4] = b & 0xff;
        canvas[dstOff + 5] = b >>> 8;

        srcOff += 6;
        dstOff += 6;
      }
    }
  } else {
    for (let y = 0; y < y1 - y0; y++) {
      for (let x = 0; x < clippedW; x++) {
        let effectiveOp = op;
        if (hasMask) {
          const ma = roundedRectAlpha(srcOffsetX + x, srcOffsetY + y, sw, sh, borderRadius);
          if (ma <= 0) continue;
          effectiveOp *= ma;
        }

        const srcOff = ((srcOffsetY + y) * sw + srcOffsetX + x) * 6;
        const dstOff = ((y0 + y) * canvasWidth + x0 + x) * 6;

        if (effectiveOp >= 0.999) {
          source.copy(canvas, dstOff, srcOff, srcOff + 6);
        } else {
          const invEff = 1 - effectiveOp;
          const sr = source.readUInt16LE(srcOff);
          const sg = source.readUInt16LE(srcOff + 2);
          const sb = source.readUInt16LE(srcOff + 4);
          const dr = canvas.readUInt16LE(dstOff);
          const dg = canvas.readUInt16LE(dstOff + 2);
          const db = canvas.readUInt16LE(dstOff + 4);
          canvas.writeUInt16LE(Math.round(sr * effectiveOp + dr * invEff), dstOff);
          canvas.writeUInt16LE(Math.round(sg * effectiveOp + dg * invEff), dstOff + 2);
          canvas.writeUInt16LE(Math.round(sb * effectiveOp + db * invEff), dstOff + 4);
        }
      }
    }
  }
}

/**
 * Apply a 2D affine transform to an rgb48le source and composite onto a canvas.
 *
 * For each destination pixel, the inverse transform maps back to source coordinates.
 * Bilinear interpolation samples the 4 nearest source pixels for smooth scaling/rotation.
 *
 * @param canvas     Destination rgb48le buffer, mutated in-place
 * @param source     Source rgb48le buffer (srcW * srcH * 6 bytes)
 * @param matrix     CSS transform matrix [a, b, c, d, tx, ty]
 * @param srcW       Source width in pixels
 * @param srcH       Source height in pixels
 * @param canvasW    Canvas width in pixels
 * @param canvasH    Canvas height in pixels
 * @param opacity    Optional opacity 0.0–1.0 (default 1.0)
 */
export function blitRgb48leAffine(
  canvas: Buffer,
  source: Buffer,
  matrix: number[],
  srcW: number,
  srcH: number,
  canvasW: number,
  canvasH: number,
  opacity?: number,
  borderRadius?: [number, number, number, number],
): void {
  const a = matrix[0];
  const b = matrix[1];
  const c = matrix[2];
  const d = matrix[3];
  const tx = matrix[4];
  const ty = matrix[5];
  if (
    a === undefined ||
    b === undefined ||
    c === undefined ||
    d === undefined ||
    tx === undefined ||
    ty === undefined
  )
    return;

  // Invert the 2x2 part of the affine matrix
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-10) return; // degenerate matrix

  const invA = d / det;
  const invB = -b / det;
  const invC = -c / det;
  const invD = a / det;
  const invTx = -(invA * tx + invC * ty);
  const invTy = -(invB * tx + invD * ty);

  const op = opacity ?? 1.0;
  if (op <= 0) return;

  const hasMask = borderRadius !== undefined;

  // Compute bounding box of transformed source on canvas
  const corners = [
    [tx, ty],
    [a * srcW + tx, b * srcW + ty],
    [c * srcH + tx, d * srcH + ty],
    [a * srcW + c * srcH + tx, b * srcW + d * srcH + ty],
  ];
  let minX = canvasW,
    maxX = 0,
    minY = canvasH,
    maxY = 0;
  for (const corner of corners) {
    const cx = corner[0] ?? 0;
    const cy = corner[1] ?? 0;
    if (cx < minX) minX = cx;
    if (cx > maxX) maxX = cx;
    if (cy < minY) minY = cy;
    if (cy > maxY) maxY = cy;
  }
  const startX = Math.max(0, Math.floor(minX));
  const endX = Math.min(canvasW, Math.ceil(maxX));
  const startY = Math.max(0, Math.floor(minY));
  const endY = Math.min(canvasH, Math.ceil(maxY));

  for (let dy = startY; dy < endY; dy++) {
    for (let dx = startX; dx < endX; dx++) {
      const sx = invA * dx + invC * dy + invTx;
      const sy = invB * dx + invD * dy + invTy;

      if (sx < 0 || sy < 0 || sx >= srcW || sy >= srcH) continue;

      // Apply rounded-rect mask in source coordinates
      let effectiveOp = op;
      if (hasMask) {
        const ma = roundedRectAlpha(sx, sy, srcW, srcH, borderRadius);
        if (ma <= 0) continue;
        effectiveOp *= ma;
      }

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const x1 = Math.min(x0 + 1, srcW - 1);
      const y1 = Math.min(y0 + 1, srcH - 1);

      const off00 = (y0 * srcW + x0) * 6;
      const off10 = (y0 * srcW + x1) * 6;
      const off01 = (y1 * srcW + x0) * 6;
      const off11 = (y1 * srcW + x1) * 6;

      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      const sr =
        source.readUInt16LE(off00) * w00 +
        source.readUInt16LE(off10) * w10 +
        source.readUInt16LE(off01) * w01 +
        source.readUInt16LE(off11) * w11;
      const sg =
        source.readUInt16LE(off00 + 2) * w00 +
        source.readUInt16LE(off10 + 2) * w10 +
        source.readUInt16LE(off01 + 2) * w01 +
        source.readUInt16LE(off11 + 2) * w11;
      const sb =
        source.readUInt16LE(off00 + 4) * w00 +
        source.readUInt16LE(off10 + 4) * w10 +
        source.readUInt16LE(off01 + 4) * w01 +
        source.readUInt16LE(off11 + 4) * w11;

      const dstOff = (dy * canvasW + dx) * 6;

      if (effectiveOp >= 0.999) {
        canvas.writeUInt16LE(Math.round(sr), dstOff);
        canvas.writeUInt16LE(Math.round(sg), dstOff + 2);
        canvas.writeUInt16LE(Math.round(sb), dstOff + 4);
      } else {
        const invEff = 1 - effectiveOp;
        const dr = canvas.readUInt16LE(dstOff);
        const dg = canvas.readUInt16LE(dstOff + 2);
        const db = canvas.readUInt16LE(dstOff + 4);
        canvas.writeUInt16LE(Math.round(sr * effectiveOp + dr * invEff), dstOff);
        canvas.writeUInt16LE(Math.round(sg * effectiveOp + dg * invEff), dstOff + 2);
        canvas.writeUInt16LE(Math.round(sb * effectiveOp + db * invEff), dstOff + 4);
      }
    }
  }
}

/**
 * CSS `object-fit` values supported by the HDR image/video resampler.
 *
 * Matches the CSS spec subset that browsers actually render for replaced
 * elements (`<img>`, `<video>`). `scale-down` is normalized to whichever of
 * `none` or `contain` produces the smaller rendered size, mirroring the spec.
 */
export type ObjectFit = "fill" | "cover" | "contain" | "none" | "scale-down";

/**
 * Parse a single axis of a CSS `object-position` string into a fraction in
 * `[0, 1]` (proportion of the slack space along that axis).
 *
 * Defaults to 0.5 (centered) for unrecognized inputs to match CSS, which
 * resolves invalid `object-position` values to the initial value (`50% 50%`).
 */
function parseObjectPositionAxis(value: string, axis: "x" | "y"): number {
  const lower = value.trim().toLowerCase();
  if (lower === "left" || lower === "top") return 0;
  if (lower === "right" || lower === "bottom") return 1;
  if (lower === "center" || lower === "") return 0.5;
  if (lower.endsWith("%")) {
    const pct = parseFloat(lower) / 100;
    return Number.isFinite(pct) ? Math.max(0, Math.min(1, pct)) : 0.5;
  }
  // Pixel values (e.g. "10px") aren't fractional; without the slack-space
  // numerator we can't honor them precisely. Fall back to center — this is
  // strictly worse than the browser but matches what we'd render today.
  if (axis === "x" || axis === "y") return 0.5;
  return 0.5;
}

/**
 * Parse a CSS `object-position` string like `"50% 50%"`, `"center top"`, or
 * `"25% 75%"` into normalized `[0, 1]` fractions for X and Y.
 *
 * The fractions express how the slack space (the portion of the layout box
 * not covered by the rendered content) should be distributed between the
 * leading and trailing edges. `0` aligns to the left/top, `1` to the
 * right/bottom, `0.5` (the default) centers the content.
 */
function parseObjectPosition(css: string | undefined): { x: number; y: number } {
  if (!css || !css.trim()) return { x: 0.5, y: 0.5 };
  const tokens = css.trim().split(/\s+/);
  if (tokens.length === 1) {
    const single = tokens[0] ?? "";
    const v = parseObjectPositionAxis(single, "x");
    return { x: v, y: 0.5 };
  }
  return {
    x: parseObjectPositionAxis(tokens[0] ?? "", "x"),
    y: parseObjectPositionAxis(tokens[1] ?? "", "y"),
  };
}

/**
 * Compute the rendered rectangle for an `object-fit` value.
 *
 * Returns the destination box (`dx`, `dy`, `dw`, `dh`) where the source image
 * lands inside the layout box. For `cover` the rectangle extends past the
 * layout box on the crop axis; the resampler clamps that overflow to the
 * destination buffer bounds.
 */
function computeObjectFitRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  fit: ObjectFit,
  pos: { x: number; y: number },
): { dx: number; dy: number; dw: number; dh: number } {
  let renderedW = dstW;
  let renderedH = dstH;
  if (fit === "fill") {
    return { dx: 0, dy: 0, dw: dstW, dh: dstH };
  }
  if (fit === "none") {
    renderedW = srcW;
    renderedH = srcH;
  } else if (fit === "scale-down") {
    // Pick the smaller of `none` and `contain` rendered sizes.
    const scale = Math.min(dstW / srcW, dstH / srcH, 1);
    renderedW = srcW * scale;
    renderedH = srcH * scale;
  } else if (fit === "cover") {
    const scale = Math.max(dstW / srcW, dstH / srcH);
    renderedW = srcW * scale;
    renderedH = srcH * scale;
  } else {
    // contain
    const scale = Math.min(dstW / srcW, dstH / srcH);
    renderedW = srcW * scale;
    renderedH = srcH * scale;
  }
  const dx = (dstW - renderedW) * pos.x;
  const dy = (dstH - renderedH) * pos.y;
  return { dx, dy, dw: renderedW, dh: renderedH };
}

/**
 * Resample an `rgb48le` image buffer into a destination box of `dstW × dstH`,
 * honoring CSS `object-fit` and `object-position` semantics.
 *
 * Used at HDR-image setup so the per-frame blit can treat the buffer as if it
 * were sized to the element's layout box, mirroring how browsers render
 * `<img object-fit:…>` for SDR content. Pixels that fall outside the rendered
 * rectangle (the letterboxed/pillarboxed area for `contain` and `none`) are
 * filled with opaque black, matching the default background for replaced
 * elements without a transparent canvas.
 *
 * Sampling is bilinear, which is what `blitRgb48leAffine` already uses for
 * its on-canvas affine scale, so a one-time resample here matches the visual
 * quality the rest of the pipeline produces.
 *
 * Returns the source buffer unchanged when `dstW === srcW && dstH === srcH`
 * and `fit === "fill"`, so callers can call this unconditionally without
 * paying for an unnecessary copy.
 */
export function resampleRgb48leObjectFit(
  source: Buffer,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  fit: ObjectFit = "fill",
  objectPosition?: string,
): Buffer {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) {
    return source;
  }
  if (fit === "fill" && srcW === dstW && srcH === dstH) {
    return source;
  }

  const pos = parseObjectPosition(objectPosition);
  const rect = computeObjectFitRect(srcW, srcH, dstW, dstH, fit, pos);
  const dst = Buffer.alloc(dstW * dstH * 6); // pre-zeroed → opaque black background

  const stride = dstW * 6;
  // For each destination pixel that lies inside the rendered rect, sample
  // the source bilinearly. Pixels outside the rect are left as the
  // pre-zeroed black background (letterbox/pillarbox area).
  const xMin = Math.max(0, Math.floor(rect.dx));
  const yMin = Math.max(0, Math.floor(rect.dy));
  const xMax = Math.min(dstW, Math.ceil(rect.dx + rect.dw));
  const yMax = Math.min(dstH, Math.ceil(rect.dy + rect.dh));

  if (rect.dw <= 0 || rect.dh <= 0) {
    return dst;
  }

  const invScaleX = srcW / rect.dw;
  const invScaleY = srcH / rect.dh;

  for (let dy = yMin; dy < yMax; dy++) {
    const rowOff = dy * stride;
    const sy = (dy + 0.5 - rect.dy) * invScaleY - 0.5;
    const syc = Math.max(0, Math.min(srcH - 1, sy));
    const y0 = Math.floor(syc);
    const y1 = Math.min(y0 + 1, srcH - 1);
    const fy = syc - y0;
    const ify = 1 - fy;

    for (let dx = xMin; dx < xMax; dx++) {
      const sx = (dx + 0.5 - rect.dx) * invScaleX - 0.5;
      const sxc = Math.max(0, Math.min(srcW - 1, sx));
      const x0 = Math.floor(sxc);
      const x1 = Math.min(x0 + 1, srcW - 1);
      const fx = sxc - x0;
      const ifx = 1 - fx;

      const off00 = (y0 * srcW + x0) * 6;
      const off10 = (y0 * srcW + x1) * 6;
      const off01 = (y1 * srcW + x0) * 6;
      const off11 = (y1 * srcW + x1) * 6;

      const w00 = ifx * ify;
      const w10 = fx * ify;
      const w01 = ifx * fy;
      const w11 = fx * fy;

      const r =
        source.readUInt16LE(off00) * w00 +
        source.readUInt16LE(off10) * w10 +
        source.readUInt16LE(off01) * w01 +
        source.readUInt16LE(off11) * w11;
      const g =
        source.readUInt16LE(off00 + 2) * w00 +
        source.readUInt16LE(off10 + 2) * w10 +
        source.readUInt16LE(off01 + 2) * w01 +
        source.readUInt16LE(off11 + 2) * w11;
      const b =
        source.readUInt16LE(off00 + 4) * w00 +
        source.readUInt16LE(off10 + 4) * w10 +
        source.readUInt16LE(off01 + 4) * w01 +
        source.readUInt16LE(off11 + 4) * w11;

      const dstOff = rowOff + dx * 6;
      dst.writeUInt16LE(Math.round(r), dstOff);
      dst.writeUInt16LE(Math.round(g), dstOff + 2);
      dst.writeUInt16LE(Math.round(b), dstOff + 4);
    }
  }

  return dst;
}

/**
 * Coerce a CSS `object-fit` value to the supported subset. Anything else
 * (including `inherit`, `initial`, the empty string, or vendor-prefixed
 * values) collapses to `"fill"` — the CSS default for replaced elements.
 */
export function normalizeObjectFit(value: string | undefined): ObjectFit {
  switch ((value ?? "").trim().toLowerCase()) {
    case "cover":
      return "cover";
    case "contain":
      return "contain";
    case "none":
      return "none";
    case "scale-down":
      return "scale-down";
    default:
      return "fill";
  }
}

/**
 * Parse a CSS `matrix(a,b,c,d,e,f)` or `matrix3d(...)` string into a 6-element
 * 2D affine array.
 *
 * Returns null for `"none"`, empty input, or syntactically malformed values.
 *
 * The returned array maps to the CSS matrix: [a, b, c, d, tx, ty] where:
 *   | a  c  tx |     (a=scaleX, b=skewY, c=skewX, d=scaleY, tx/ty=translate)
 *   | b  d  ty |
 *   | 0  0  1  |
 *
 * `matrix3d` is the default output of `DOMMatrix.toString()` whenever any
 * ancestor in the chain has used a 3D transform — most importantly GSAP's
 * default `force3D: true`, which converts `translate(...)` into
 * `translate3d(..., 0)` and surfaces as `matrix3d(...)` even for purely 2D
 * animations. Without explicit handling we'd silently drop every transform
 * driven by GSAP. The 16 values are in column-major order:
 *
 *   matrix3d(m11, m12, m13, m14, m21, m22, m23, m24, m31, m32, m33, m34,
 *            m41, m42, m43, m44)
 *
 * The 2D affine corresponds to indices 0, 1, 4, 5, 12, 13 (m11, m12, m21,
 * m22, m41, m42). Z, perspective, and out-of-plane rotation components are
 * dropped — for true 3D transforms the resulting 2D projection is only
 * approximate, but for the GSAP `force3D: true` flat-matrix case it is exact.
 *
 * When a `matrix3d` arrives with Z-significant components (m13, m23, m31,
 * m32, m34, m43 != 0 or m33 != 1) we emit a one-time `console.warn` so
 * authors using real 3D transforms know the engine path is silently
 * flattening their scene rather than failing it.
 */
export function parseTransformMatrix(css: string): number[] | null {
  if (!css || css === "none") return null;

  const match2d = css.match(
    /^matrix\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,)]+)\s*\)$/,
  );
  if (match2d) {
    const values = match2d.slice(1, 7).map(Number);
    if (!values.every(Number.isFinite)) return null;
    return values;
  }

  const match3d = css.match(/^matrix3d\(\s*([^)]+)\)$/);
  if (match3d) {
    const raw = match3d[1];
    if (!raw) return null;
    const parts = raw.split(",").map((s) => Number(s.trim()));
    if (parts.length !== 16 || !parts.every(Number.isFinite)) return null;
    // 3D-significance check: a flat 2D transform expressed as matrix3d has
    // a3=b3=c1=c2=d1=d2=d3=0, c3=1, d4=1. Any deviation means the composition
    // is using real 3D (perspective, rotateX/Y) which the engine path can't
    // represent — we project to 2D and the visual will silently drop depth.
    // Warn once per process so authors don't get a misleading "looks fine in
    // studio, broken in render" experience without any signal. Z translation
    // (c4 = parts[14]) is intentionally dropped by the 2D projection below
    // and does NOT trigger this warning — that's the GSAP `force3D: true`
    // happy path.
    warnIfZSignificant(parts);
    // Extract column-major 2D affine: m11, m12, m21, m22, m41, m42.
    return [
      parts[0] as number,
      parts[1] as number,
      parts[4] as number,
      parts[5] as number,
      parts[12] as number,
      parts[13] as number,
    ];
  }

  return null;
}

let warnedZSignificant = false;
const Z_EPSILON = 1e-6;

function warnIfZSignificant(parts: number[]): void {
  if (warnedZSignificant) return;
  // CSS matrix3d() is column-major:
  //   matrix3d(a1, b1, c1, d1, a2, b2, c2, d2, a3, b3, c3, d3, a4, b4, c4, d4)
  // laid out as:
  //   | a1 a2 a3 a4 |   | parts[0]  parts[4]  parts[8]  parts[12] |
  //   | b1 b2 b3 b4 | = | parts[1]  parts[5]  parts[9]  parts[13] |
  //   | c1 c2 c3 c4 |   | parts[2]  parts[6]  parts[10] parts[14] |
  //   | d1 d2 d3 d4 |   | parts[3]  parts[7]  parts[11] parts[15] |
  //
  // For a flat 2D transform — the only thing this engine path can render
  // faithfully — we expect:
  //   a3 = b3 = c1 = c2 = 0   (no XZ/YZ rotation coupling)
  //   c3 = 1                  (no Z scaling)
  //   d1 = d2 = d3 = 0        (no perspective)
  //   d4 = 1                  (no homogeneous scaling)
  // Z translation (c4 = parts[14]) is explicitly dropped by the 2D affine
  // extraction below — that's the whole point of supporting GSAP's
  // `force3D: true` translate3d(x, y, 0) emission — so it is NOT flagged.
  const a3 = parts[8] ?? 0;
  const b3 = parts[9] ?? 0;
  const c1 = parts[2] ?? 0;
  const c2 = parts[6] ?? 0;
  const c3 = parts[10] ?? 1;
  const d1 = parts[3] ?? 0;
  const d2 = parts[7] ?? 0;
  const d3 = parts[11] ?? 0;
  const d4 = parts[15] ?? 1;
  if (
    Math.abs(a3) > Z_EPSILON ||
    Math.abs(b3) > Z_EPSILON ||
    Math.abs(c1) > Z_EPSILON ||
    Math.abs(c2) > Z_EPSILON ||
    Math.abs(c3 - 1) > Z_EPSILON ||
    Math.abs(d1) > Z_EPSILON ||
    Math.abs(d2) > Z_EPSILON ||
    Math.abs(d3) > Z_EPSILON ||
    Math.abs(d4 - 1) > Z_EPSILON
  ) {
    warnedZSignificant = true;
    console.warn(
      `[alphaBlit] parseTransformMatrix received a matrix3d with non-trivial 3D components ` +
        `(a3=${a3}, b3=${b3}, c1=${c1}, c2=${c2}, c3=${c3}, d1=${d1}, d2=${d2}, d3=${d3}, d4=${d4}). ` +
        `The engine projects 3D transforms to 2D (m11, m12, m21, m22, m41, m42) and silently ` +
        `discards perspective and out-of-plane rotation. If your composition uses real 3D ` +
        `(rotateX/Y, perspective), the rendered output will not match the studio preview. ` +
        `Z translation (translateZ) is dropped by design and does not trigger this warning. ` +
        `This warning is emitted once per process.`,
    );
  }
}
