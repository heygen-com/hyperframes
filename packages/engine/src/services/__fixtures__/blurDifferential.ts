// Two pixel invariants for checking motion-blurred capture against a blur-off render.
// Outside the trail of everything that moved, blur on must equal blur off. Inside it, the
// blur-off render's own sub-frames averaged together are the answer blur on must reproduce.

export interface Rgba {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface BadBlock {
  x: number;
  y: number;
  mae: number;
}

export interface Differential {
  blocks: number;
  checkedBlocks: number;
  checkedFraction: number;
  worstMae: number;
  bad: BadBlock[];
}

const CHANGED_ABOVE = 2;
const DEFAULT_BLOCK = 16;
const DEFAULT_MAX_MAE = 8;

function assertSameSize(frames: readonly Rgba[]): Rgba {
  const first = frames[0];
  if (!first) throw new Error("expected at least one frame");
  for (const frame of frames) {
    if (frame.width !== first.width || frame.height !== first.height) {
      throw new Error(
        `frame size mismatch: ${frame.width}x${frame.height} vs ${first.width}x${first.height}`,
      );
    }
  }
  return first;
}

function cellAt(
  source: Uint8Array,
  base: number,
  step: number,
  index: number,
  length: number,
): number {
  if (index < 0 || index >= length) return 0;
  return source[base + index * step] ?? 0;
}

// For every line, 1 where any source value within `radius` along the line is set.
function boxMaxAlongAxis(
  source: Uint8Array,
  target: Uint8Array,
  lines: number,
  lineLength: number,
  step: number,
  lineStep: number,
  radius: number,
): void {
  for (let line = 0; line < lines; line++) {
    const base = line * lineStep;
    let inWindow = 0;
    for (let i = 0; i < radius; i++) inWindow += cellAt(source, base, step, i, lineLength);
    for (let i = 0; i < lineLength; i++) {
      inWindow += cellAt(source, base, step, i + radius, lineLength);
      inWindow -= cellAt(source, base, step, i - radius - 1, lineLength);
      target[base + i * step] = inWindow > 0 ? 1 : 0;
    }
  }
}

function channelRange(frames: readonly Rgba[], first: Rgba): { low: Uint8Array; high: Uint8Array } {
  const low = first.data.slice();
  const high = first.data.slice();
  for (const { data } of frames) {
    for (let i = 0; i < data.length; i++) {
      const v = data[i] ?? 0;
      low[i] = Math.min(low[i] ?? v, v);
      high[i] = Math.max(high[i] ?? v, v);
    }
  }
  return { low, high };
}

function pixelChanged(low: Uint8Array, high: Uint8Array, pixel: number): boolean {
  for (let c = pixel * 4; c < pixel * 4 + 4; c++) {
    if ((high[c] ?? 0) - (low[c] ?? 0) > CHANGED_ABOVE) return true;
  }
  return false;
}

export function trailMask(frames: readonly Rgba[], radiusPx: number): Uint8Array {
  const first = assertSameSize(frames);
  if (!Number.isInteger(radiusPx) || radiusPx < 0) {
    throw new RangeError(`radiusPx must be a non-negative integer, got ${radiusPx}`);
  }
  const { width, height } = first;
  const { low, high } = channelRange(frames, first);
  const changed = new Uint8Array(width * height);
  for (let p = 0; p < changed.length; p++) changed[p] = pixelChanged(low, high, p) ? 1 : 0;
  if (radiusPx === 0) return changed;
  const horizontal = new Uint8Array(changed.length);
  boxMaxAlongAxis(changed, horizontal, height, width, 1, width, radiusPx);
  const dilated = new Uint8Array(changed.length);
  boxMaxAlongAxis(horizontal, dilated, width, height, width, 1, radiusPx);
  return dilated;
}

export function meanFrame(frames: readonly Rgba[]): Rgba {
  const first = assertSameSize(frames);
  const sums = new Uint32Array(first.data.length);
  for (const frame of frames) {
    const { data } = frame;
    for (let i = 0; i < data.length; i++) sums[i] = (sums[i] ?? 0) + (data[i] ?? 0);
  }
  const data = new Uint8Array(sums.length);
  for (let i = 0; i < sums.length; i++) data[i] = Math.round((sums[i] ?? 0) / frames.length);
  return { width: first.width, height: first.height, data };
}

interface TileStats {
  maskedPixels: number;
  pixels: number;
  absDiffSum: number;
}

function tileStats(
  reference: Rgba,
  actual: Rgba,
  mask: Uint8Array,
  x0: number,
  y0: number,
  block: number,
): TileStats {
  const { width, height } = reference;
  const x1 = Math.min(x0 + block, width);
  const y1 = Math.min(y0 + block, height);
  let maskedPixels = 0;
  let absDiffSum = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = y * width + x;
      maskedPixels += mask[p] ? 1 : 0;
      const i = p * 4;
      for (let c = 0; c < 3; c++) {
        absDiffSum += Math.abs((reference.data[i + c] ?? 0) - (actual.data[i + c] ?? 0));
      }
    }
  }
  return { maskedPixels, pixels: (x1 - x0) * (y1 - y0), absDiffSum };
}

function isChecked(stats: TileStats, region: "outside" | "inside"): boolean {
  return region === "inside" ? stats.maskedPixels > 0 : stats.maskedPixels === 0;
}

export function compareTiles(
  reference: Rgba,
  actual: Rgba,
  mask: Uint8Array,
  region: "outside" | "inside",
  options: { block?: number; maxMae?: number } = {},
): Differential {
  const block = options.block ?? DEFAULT_BLOCK;
  const maxMae = options.maxMae ?? DEFAULT_MAX_MAE;
  assertSameSize([reference, actual]);
  const { width, height } = reference;
  if (mask.length !== width * height) {
    throw new Error(`mask length ${mask.length} does not match ${width}x${height}`);
  }
  if (!Number.isInteger(block) || block < 1) {
    throw new RangeError(`block must be a positive integer, got ${block}`);
  }
  let blocks = 0;
  let checkedBlocks = 0;
  let checkedPixels = 0;
  let worstMae = 0;
  const bad: BadBlock[] = [];
  for (let y = 0; y < height; y += block) {
    for (let x = 0; x < width; x += block) {
      blocks++;
      const stats = tileStats(reference, actual, mask, x, y, block);
      if (!isChecked(stats, region)) continue;
      checkedBlocks++;
      checkedPixels += stats.pixels;
      const mae = stats.absDiffSum / (stats.pixels * 3);
      worstMae = Math.max(worstMae, mae);
      if (mae > maxMae) bad.push({ x, y, mae });
    }
  }
  return {
    blocks,
    checkedBlocks,
    checkedFraction: checkedPixels / (width * height),
    worstMae,
    bad,
  };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const REGION_TOLERANCE_PX = 2;
const SYMPTOM_BAND = { low: 0.5, high: 2 };

/** True when the tile, in device pixels, overlaps the CSS-pixel rect widened by the tolerance. */
export function tileTouches(
  tile: { x: number; y: number },
  block: number,
  rect: Rect,
  dpr: number,
): boolean {
  const pad = REGION_TOLERANCE_PX * dpr;
  const left = rect.x * dpr - pad;
  const top = rect.y * dpr - pad;
  const right = (rect.x + rect.width) * dpr + pad;
  const bottom = (rect.y + rect.height) * dpr + pad;
  return tile.x < right && tile.x + block > left && tile.y < bottom && tile.y + block > top;
}

/** The bad tiles that do not touch the rect: a defect somewhere the pinned symptom does not explain. */
export function tilesOutsideRegion(
  bad: readonly BadBlock[],
  block: number,
  rect: Rect,
  dpr: number,
): BadBlock[] {
  return bad.filter((tile) => !tileTouches(tile, block, rect, dpr));
}

/** True when a pinned symptom's worst MAE is still within half to double of the value measured when it was pinned. */
export function withinSymptomBand(worstMae: number, measured: number): boolean {
  return worstMae >= SYMPTOM_BAND.low * measured && worstMae <= SYMPTOM_BAND.high * measured;
}
