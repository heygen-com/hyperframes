// Which shots resume an earlier camera setup, by the scene's edges: a person moves and exposure drifts, walls do not.
import { SIG_H, SIG_W, type Cut } from "./cuts.js";

/** Cells across and down, 8 x 6 pixels each: small enough that a person or a title spoils only a few. */
const COLS = 8;
const ROWS = 6;
const CELL_W = SIG_W / COLS;
const CELL_H = SIG_H / ROWS;
/** Frames taken from each end of a shot, a median a pixel: one blended or flashed frame at a cut drops out. */
const PLATE_FRAMES = 3;
/** Mean squared gradient a pixel for a cell to say anything: under it a wall or a sky is flat, and noise decides. */
const TEXTURED = 15;
/** The weaker picture's share of the stronger one's edges in a cell: a flat card matches nothing. */
const BOTH_TEXTURED = 0.25;
/** Gradient correlation for a cell to be the same piece of scene: a still camera gives 0.9 and up. */
const CELL_AGREES = 0.75;
/** Textured cells out of all: with fewer, the picture has too little structure to tell two setups apart. */
const MIN_TEXTURED = 0.35;
/** Agreeing cells out of the textured ones. Other scenes read under 0.6 and the same room framed tighter or
 * wider 0.6 to 0.7: a wrong match joins two takes, a miss costs none. */
const MIN_AGREEING = 0.75;
/** Pixels (of 64 x 36) the picture may have slid between the two ends: a hand-held take never returns exactly. */
const DRIFT = 1;
const WORTH_SLIDING = MIN_AGREEING / 2;

export interface Likeness {
  textured: number;
  agreeing: number;
}

interface Plate {
  gx: Float32Array;
  gy: Float32Array;
}

const median3 = (a: number, b: number, c: number) =>
  Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));

function meanOf3x3Around(px: Float32Array, x: number, y: number): number {
  let [sum, n] = [0, 0];
  for (let v = Math.max(0, y - 1); v <= Math.min(SIG_H - 1, y + 1); v++)
    for (let u = Math.max(0, x - 1); u <= Math.min(SIG_W - 1, x + 1); u++) {
      sum += px[v * SIG_W + u]!;
      n++;
    }
  return sum / n;
}

function plate(frames: Uint8Array[]): Plate {
  const gx = new Float32Array(SIG_W * SIG_H);
  const gy = new Float32Array(SIG_W * SIG_H);
  const a = frames[0];
  if (!a) return { gx, gy };
  const b = frames[1] ?? a;
  const c = frames[2] ?? b;
  const still = gx.map((_, i) => median3(a[i]!, b[i]!, c[i]!));
  const soft = still.map((_, i) => meanOf3x3Around(still, i % SIG_W, Math.floor(i / SIG_W)));
  for (let y = 1; y < SIG_H - 1; y++)
    for (let x = 1; x < SIG_W - 1; x++) {
      const i = y * SIG_W + x;
      gx[i] = soft[i + 1]! - soft[i - 1]!;
      gy[i] = soft[i + SIG_W]! - soft[i - SIG_W]!;
    }
  return { gx, gy };
}

function cellAgrees(
  a: Plate,
  b: Plate,
  [col, row]: [number, number],
  [dx, dy]: [number, number],
): boolean | undefined {
  let [aa, bb, ab, n] = [0, 0, 0, 0];
  const yEnd = Math.min((row + 1) * CELL_H, SIG_H - dy);
  const xEnd = Math.min((col + 1) * CELL_W, SIG_W - dx);
  for (let y = Math.max(row * CELL_H, -dy); y < yEnd; y++)
    for (let x = Math.max(col * CELL_W, -dx); x < xEnd; x++) {
      const i = y * SIG_W + x;
      const j = i + dy * SIG_W + dx;
      aa += a.gx[i]! ** 2 + a.gy[i]! ** 2;
      bb += b.gx[j]! ** 2 + b.gy[j]! ** 2;
      ab += a.gx[i]! * b.gx[j]! + a.gy[i]! * b.gy[j]!;
      n++;
    }
  if (Math.max(aa, bb) <= TEXTURED * n) return undefined;
  return (
    Math.min(aa, bb) >= BOTH_TEXTURED * Math.max(aa, bb) && ab >= CELL_AGREES * Math.sqrt(aa * bb)
  );
}

function likenessAt(a: Plate, b: Plate, dx: number, dy: number): Likeness {
  let [textured, agreeing] = [0, 0];
  for (let cell = 0; cell < COLS * ROWS; cell++) {
    const agrees = cellAgrees(a, b, [cell % COLS, Math.floor(cell / COLS)], [dx, dy]);
    if (agrees === undefined) continue;
    textured++;
    if (agrees) agreeing++;
  }
  return { textured, agreeing };
}

function likeness(a: Plate, b: Plate): Likeness {
  let best = likenessAt(a, b, 0, 0);
  if (best.agreeing < WORTH_SLIDING * best.textured) return best;
  for (let dy = -DRIFT; dy <= DRIFT; dy++)
    for (let dx = -DRIFT; dx <= DRIFT; dx++) {
      const at = dx || dy ? likenessAt(a, b, dx, dy) : best;
      if (at.agreeing > best.agreeing) best = at;
    }
  return best;
}

const isSame = ({ textured, agreeing }: Likeness) =>
  textured >= MIN_TEXTURED * COLS * ROWS && agreeing >= MIN_AGREEING * textured;

export function setupLikeness(a: Uint8Array[], b: Uint8Array[]): Likeness {
  return likeness(plate(a), plate(b));
}

export function sameSetup(a: Uint8Array[], b: Uint8Array[]): boolean {
  return isSame(setupLikeness(a, b));
}

/**
 * For each shot between `cuts`, the index of the earlier shot whose camera setup it resumes after at least one other
 * shot. A match with the shot right before is a jump cut, which the cut already tells; the most recent match wins.
 */
export function continuedShots(frames: Uint8Array[], cuts: Cut[]): (number | undefined)[] {
  const starts = [0, ...cuts.map((c) => c.frame + c.frames - 1)];
  const ends = [...cuts.map((c) => c.frame), frames.length];
  const heads = starts.map((s, i) => plate(frames.slice(s, Math.min(s + PLATE_FRAMES, ends[i]!))));
  const tails = ends.map((e, i) => plate(frames.slice(Math.max(starts[i]!, e - PLATE_FRAMES), e)));
  return heads.map((head, i) => {
    if (i < 2 || isSame(likeness(tails[i - 1]!, head))) return undefined;
    for (let j = i - 2; j >= 0; j--) if (isSame(likeness(tails[j]!, head))) return j;
    return undefined;
  });
}
