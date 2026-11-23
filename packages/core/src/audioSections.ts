/**
 * Sections from signal processing: band energies and chroma averaged into half-second blocks, a self-similarity matrix, and
 * Foote's checkerboard novelty, whose peaks are where the music changes. Boundaries snap to the nearest beat.
 */

import type { AudioSignal } from "./audioAnalysis";
import { bandFramesOf, medianInterval, rhythm, type BandFrames } from "./audioRhythm";
import { snapper, type SnapReport } from "./audioSnap";

export interface Section {
  start: number;
  end: number;
  /** Sections that sound alike share a letter. */
  label: string;
}

export interface Sections {
  spans: Section[];
  snap?: SnapReport;
}

export interface SectionOptions {
  /** Shortest section, in seconds. */
  minSeconds?: number;
}

const BLOCK_SECONDS = 0.5;
/** Checkerboard half-width: eight seconds of music either side of a candidate boundary. */
const KERNEL_BLOCKS = 16;
const SAME_SECTION = 0.9;

const round = (t: number) => Math.round(t * 1000) / 1000;

function meanOf(frames: ArrayLike<number>[]): number[] {
  const sum = new Array<number>(frames[0]?.length ?? 0).fill(0);
  for (const frame of frames) for (let b = 0; b < sum.length; b++) sum[b]! += frame[b]!;
  return sum.map((v) => v / (frames.length || 1));
}

/** Each band moved to zero mean and unit spread over time, in place. */
function standardizeBands(blocks: number[][]): void {
  for (let b = 0; b < (blocks[0]?.length ?? 0); b++) {
    const column = blocks.map((block) => block[b]!);
    const mean = column.reduce((a, v) => a + v, 0) / column.length;
    const spread = Math.sqrt(column.reduce((a, v) => a + (v - mean) ** 2, 0) / column.length);
    for (const block of blocks) block[b] = (block[b]! - mean) / (spread || 1);
  }
}

/** Block means of the band energies and of the log chroma, each part unit length within a block. */
function blockParts({ fps, bands, chroma, chromaFps }: BandFrames): number[][] {
  const per = Math.max(1, Math.round(BLOCK_SECONDS * fps));
  const chromaPer = Math.max(1, Math.round(BLOCK_SECONDS * chromaFps));
  const blocks: number[][] = [];
  for (let start = 0, b = 0; start + per <= bands.length; start += per, b++) {
    const pitch = meanOf(chroma.slice(b * chromaPer, (b + 1) * chromaPer)).map(Math.log1p);
    blocks.push([...meanOf(bands.slice(start, start + per)), ...unit(pitch)]);
  }
  return blocks;
}

function blockFeatures(frames: BandFrames): number[][] {
  const blocks = blockParts(frames);
  standardizeBands(blocks);
  const split = frames.bands[0]?.length ?? 0;
  return blocks.map((block) =>
    [...unit(block.slice(0, split)), ...unit(block.slice(split))].map((v) => v * Math.SQRT1_2),
  );
}

function unit(vector: number[]): number[] {
  const length = Math.hypot(...vector) || 1;
  return vector.map((v) => v / length);
}

const dot = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i]!, 0);

/** The checkerboard kernel, offsets -KERNEL_BLOCKS…KERNEL_BLOCKS-1 each way: + within a side, − across, tapered. */
const CHECKERBOARD = (() => {
  const offsets = Array.from({ length: 2 * KERNEL_BLOCKS }, (_, k) => k - KERNEL_BLOCKS);
  const taper = (k: number) =>
    Math.exp(-0.5 * (((k < 0 ? -k - 1 : k) + 0.5) / (KERNEL_BLOCKS / 2)) ** 2);
  return offsets.map((a) => offsets.map((b) => (a < 0 === b < 0 ? 1 : -1) * taper(a) * taper(b)));
})();

/** Foote novelty at block `i`: similarity within each side of it minus similarity across it. */
function noveltyAt(blocks: number[][], i: number): number {
  let sum = 0;
  CHECKERBOARD.forEach((row, a) => {
    const x = blocks[i + a - KERNEL_BLOCKS];
    if (!x) return;
    row.forEach((weight, b) => {
      const y = blocks[i + b - KERNEL_BLOCKS];
      if (y) sum += weight * dot(x, y);
    });
  });
  return sum;
}

const novelty = (blocks: number[][]) => blocks.map((_, i) => noveltyAt(blocks, i));

/** Blocks where novelty peaks over its neighbourhood and clears the mean by a standard deviation. */
function boundaryBlocks(curve: number[], minBlocks: number): number[] {
  const mean = curve.reduce((a, b) => a + b, 0) / (curve.length || 1);
  const spread = Math.sqrt(curve.reduce((a, v) => a + (v - mean) ** 2, 0) / (curve.length || 1));
  const peaks: number[] = [];
  for (let i = minBlocks; i <= curve.length - minBlocks; i++) {
    const neighbourhood = curve.slice(Math.max(0, i - minBlocks), i + minBlocks + 1);
    if (curve[i]! < Math.max(...neighbourhood) || curve[i]! <= mean + spread) continue;
    if (!peaks.length || i - peaks[peaks.length - 1]! >= minBlocks) peaks.push(i);
  }
  return peaks;
}

/** A letter per span: the letter of the first earlier span whose mean features are this alike, else a new one. */
function labels(blocks: number[][], edges: number[]): string[] {
  const means: number[][] = [];
  const letters: string[] = [];
  for (let s = 0; s + 1 < edges.length; s++) {
    const part = blocks.slice(edges[s]!, edges[s + 1]!);
    const mean = unit(part[0]!.map((_, b) => part.reduce((a, block) => a + block[b]!, 0)));
    const match = means.findIndex((other) => dot(other, mean) >= SAME_SECTION);
    letters.push(
      match >= 0 ? letters[match]! : String.fromCharCode(65 + (new Set(letters).size % 26)),
    );
    means.push(mean);
  }
  return letters;
}

/** Half the median beat interval: a boundary moves to a beat, never past one. */
const beatTolerance = (beats: number[]) => (medianInterval(beats) ?? 0) / 2;

export function sections(signal: AudioSignal, options: SectionOptions = {}): Sections {
  const duration = round((signal.channels[0]?.length ?? 0) / signal.sampleRate);
  const blocks = blockFeatures(bandFramesOf(signal));
  const minBlocks = Math.max(1, Math.round((options.minSeconds ?? 4) / BLOCK_SECONDS));
  if (blocks.length < 2 * minBlocks) return { spans: [{ start: 0, end: duration, label: "A" }] };
  const edges = [0, ...boundaryBlocks(novelty(blocks), minBlocks), blocks.length];
  const letters = labels(blocks, edges);
  const beats = rhythm(signal).beats.times;
  const onBeat = snapper(beats, beatTolerance(beats), "signal beats");
  const times = edges.map((e, i) =>
    i === 0 ? 0 : i === edges.length - 1 ? duration : round(onBeat.snap(e * BLOCK_SECONDS)),
  );
  return {
    spans: letters.map((label, s) => ({ start: times[s]!, end: times[s + 1]!, label })),
    snap: onBeat.report(),
  };
}
