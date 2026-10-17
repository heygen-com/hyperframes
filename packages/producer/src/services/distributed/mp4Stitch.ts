// Assemble for chunks that carry their audio: one faststart header (ftyp, a moov indexing every
// chunk's samples, a 64-bit mdat header); the chunks' mdat payloads follow it unchanged and in
// order, so storage can copy them into place.

import { createReadStream, createWriteStream } from "node:fs";
import { open } from "node:fs/promises";
import { finished, pipeline } from "node:stream/promises";

// ── Box reading ─────────────────────────────────────────────────────────────

interface Box {
  type: string;
  start: number;
  bodyStart: number;
  end: number;
}

/** The box whose header sits at `off` in `src`, which holds the bytes at file offset `at`. */
function boxAt(src: Buffer, off: number, at: number, limit: number): Box {
  let size = src.readUInt32BE(off);
  let bodyStart = at + 8;
  if (size === 1) {
    size = Number(src.readBigUInt64BE(off + 8));
    bodyStart = at + 16;
  }
  if (size < 8 || at + size > limit) throw new Error(`[mp4Stitch] malformed box at ${at}`);
  return { type: src.toString("latin1", off + 4, off + 8), start: at, bodyStart, end: at + size };
}

function childBoxes(buf: Buffer, parent: Box): Box[] {
  const boxes: Box[] = [];
  for (let at = parent.bodyStart; at < parent.end; at = boxes.at(-1)!.end) {
    boxes.push(boxAt(buf, at, at, parent.end));
  }
  return boxes;
}

function findChild(buf: Buffer, parent: Box, type: string): Box | undefined {
  return childBoxes(buf, parent).find((box) => box.type === type);
}

function child(buf: Buffer, parent: Box, type: string): Box {
  const found = findChild(buf, parent, type);
  if (!found) throw new Error(`[mp4Stitch] ${parent.type} has no ${type}`);
  return found;
}

/** Reads bytes `[start, end)`; returns fewer past the end of the object. */
export type ReadRange = (start: number, end: number) => Promise<Buffer>;

export interface Mp4Layout {
  ftyp: Buffer;
  moov: Buffer;
  /** File offsets of the mdat payload, `[payloadStart, payloadEnd)`. */
  payloadStart: number;
  payloadEnd: number;
}

const SCAN_BYTES = 64 * 1024;

/** Reads a chunk's ftyp and moov and locates its mdat payload without reading the payload. */
export async function readMp4Layout(read: ReadRange): Promise<Mp4Layout> {
  const found = new Map<string, Buffer>();
  let payload: Box | undefined;
  let buf: Buffer = Buffer.alloc(0);
  let bufAt = 0;
  // Holds `[start, end)` in `buf` when the object has those bytes.
  const load = async (start: number, end: number) => {
    if (start >= bufAt && end <= bufAt + buf.length) return;
    buf = await read(start, Math.max(end, start + SCAN_BYTES));
    bufAt = start;
  };
  for (let at = 0; !(found.has("ftyp") && found.has("moov") && payload); ) {
    await load(at, at + 16);
    if (at + 8 > bufAt + buf.length) {
      throw new Error(`[mp4Stitch] chunk needs ftyp, moov and mdat; found ${[...found.keys()]}`);
    }
    const box = boxAt(buf, at - bufAt, at, Number.MAX_SAFE_INTEGER);
    // Samples in a later mdat fail buildStitchedHeader's offset check.
    if (box.type === "mdat") payload ??= box;
    if (box.type === "ftyp" || box.type === "moov") {
      await load(at, box.end);
      found.set(box.type, buf.subarray(at - bufAt, box.end - bufAt));
    }
    at = box.end;
  }
  const [ftyp, moov] = [found.get("ftyp")!, found.get("moov")!];
  if (moov.length !== moovSize(moov)) throw new Error("[mp4Stitch] moov is cut off");
  return { ftyp, moov, payloadStart: payload.bodyStart, payloadEnd: payload.end };
}

const moovSize = (moov: Buffer) => boxAt(moov, 0, 0, Number.MAX_SAFE_INTEGER).end;

export interface TrackTable {
  trak: Box;
  handler: string;
  timescale: number;
  /** Media time the edit list starts presenting at (the AAC priming on audio). */
  mediaTime: number;
  stsd: Buffer;
  durations: number[];
  sizes: number[];
  /** Per-sample keyframe flags; `null` when every sample is one (no stss). */
  sync: boolean[] | null;
  samplesPerChunk: number[];
  chunkOffsets: number[];
}

/** Each track's sample tables, expanded to one entry per sample (and per chunk). */
export function readTracks(moov: Buffer): TrackTable[] {
  const root = boxAt(moov, 0, 0, moov.length);
  return childBoxes(moov, root)
    .filter((box) => box.type === "trak")
    .map((trak) => readTrack(moov, trak));
}

/** `[count, rows...]` tables: returns `columns` u32 values per row. */
function rows(buf: Buffer, table: Box, columns: number, countAt = 4): number[][] {
  const count = buf.readUInt32BE(table.bodyStart + countAt);
  const first = table.bodyStart + countAt + 4;
  return Array.from({ length: count }, (_, row) =>
    Array.from({ length: columns }, (_, col) =>
      buf.readUInt32BE(first + (row * columns + col) * 4),
    ),
  );
}

function readMediaTime(moov: Buffer, trak: Box): number {
  const edts = findChild(moov, trak, "edts");
  if (!edts) return 0;
  const elst = child(moov, edts, "elst");
  const wide = moov[elst.bodyStart] === 1;
  const entries = moov.readUInt32BE(elst.bodyStart + 4);
  for (let i = 0, at = elst.bodyStart + 8; i < entries; i++, at += wide ? 20 : 12) {
    const offset = at + (wide ? 8 : 4);
    const mediaTime = wide ? Number(moov.readBigInt64BE(offset)) : moov.readInt32BE(offset);
    if (mediaTime !== -1) return mediaTime;
  }
  return 0;
}

function readSizes(moov: Buffer, stsz: Box): number[] {
  const fixedSize = moov.readUInt32BE(stsz.bodyStart + 4);
  if (!fixedSize) return rows(moov, stsz, 1, 8).map(([size]) => size!);
  return Array<number>(moov.readUInt32BE(stsz.bodyStart + 8)).fill(fixedSize);
}

function readSync(moov: Buffer, stbl: Box, sampleCount: number): boolean[] | null {
  const stss = findChild(moov, stbl, "stss");
  if (!stss) return null;
  const sync = Array<boolean>(sampleCount).fill(false);
  for (const [n] of rows(moov, stss, 1)) sync[n! - 1] = true;
  return sync;
}

function readChunkOffsets(moov: Buffer, stbl: Box): number[] {
  const stco = findChild(moov, stbl, "stco");
  if (stco) return rows(moov, stco, 1).map(([offset]) => offset!);
  return rows(moov, child(moov, stbl, "co64"), 2).map(([hi, lo]) => hi! * 2 ** 32 + lo!);
}

function readSamplesPerChunk(moov: Buffer, stbl: Box, chunkCount: number): number[] {
  const stsc = rows(moov, child(moov, stbl, "stsc"), 3);
  return stsc.flatMap(([firstChunk, perChunk, description], i) => {
    if (description !== 1) throw new Error("[mp4Stitch] chunk uses more than one sample entry");
    const nextFirst = stsc[i + 1]?.[0] ?? chunkCount + 1;
    return Array<number>(nextFirst - firstChunk!).fill(perChunk!);
  });
}

function readTrack(moov: Buffer, trak: Box): TrackTable {
  const mdia = child(moov, trak, "mdia");
  const hdlr = child(moov, mdia, "hdlr");
  const stbl = child(moov, child(moov, mdia, "minf"), "stbl");
  // Chunks encode without B-frames; composition offsets would shift every chunk differently.
  if (findChild(moov, stbl, "ctts")) throw new Error("[mp4Stitch] chunk has ctts (B-frames)");
  const stts = rows(moov, child(moov, stbl, "stts"), 2);
  const durations = stts.flatMap(([n, delta]) => Array<number>(n!).fill(delta!));
  const sizes = readSizes(moov, child(moov, stbl, "stsz"));
  const chunkOffsets = readChunkOffsets(moov, stbl);
  const samplesPerChunk = readSamplesPerChunk(moov, stbl, chunkOffsets.length);
  if (durations.length !== sizes.length || sum(samplesPerChunk) !== sizes.length) {
    throw new Error("[mp4Stitch] sample tables disagree on the sample count");
  }
  const stsd = child(moov, stbl, "stsd");
  return {
    trak,
    handler: moov.toString("latin1", hdlr.bodyStart + 8, hdlr.bodyStart + 12),
    timescale: timescaleOf(moov, child(moov, mdia, "mdhd")),
    mediaTime: readMediaTime(moov, trak),
    stsd: moov.subarray(stsd.start, stsd.end),
    durations,
    sizes,
    sync: readSync(moov, stbl, sizes.length),
    samplesPerChunk,
    chunkOffsets,
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

// ── Box writing ─────────────────────────────────────────────────────────────

function box(type: string, ...body: Buffer[]): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + sum(body.map((part) => part.length)));
  header.write(type, 4, "latin1");
  return Buffer.concat([header, ...body]);
}

function fullBox(type: string, version: number, body: Buffer): Buffer {
  return box(type, Buffer.from([version, 0, 0, 0]), body);
}

function u32s(values: readonly number[]): Buffer {
  const buf = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => buf.writeUInt32BE(value, i * 4));
  return buf;
}

/** Run-length pairs `[count, value]` of consecutive equal values. */
function runs(values: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const value of values) {
    const last = out.at(-1);
    if (last && last[1] === value) last[0]++;
    else out.push([1, value]);
  }
  return out;
}

/** Rebuilds `parent` from its children, replacing the ones `replace` names. */
function rebuild(buf: Buffer, parent: Box, replace: Record<string, (box: Box) => Buffer>): Buffer {
  const parts = childBoxes(buf, parent).map(
    (box) => replace[box.type]?.(box) ?? buf.subarray(box.start, box.end),
  );
  return box(parent.type, ...parts);
}

// Duration field offset in the box body, for version 0 and 1.
const DURATION_AT: Record<string, [number, number]> = {
  mvhd: [16, 24],
  mdhd: [16, 24],
  tkhd: [20, 28],
};

function withDuration(buf: Buffer, target: Box, duration: number): Buffer {
  const copy = Buffer.from(buf.subarray(target.start, target.end));
  const body = target.bodyStart - target.start;
  const wide = copy[body] === 1;
  const at = body + DURATION_AT[target.type]![wide ? 1 : 0];
  if (wide) copy.writeBigUInt64BE(BigInt(duration), at);
  else if (duration <= 0xffffffff) copy.writeUInt32BE(duration, at);
  else throw new Error(`[mp4Stitch] ${target.type} duration ${duration} needs a version 1 box`);
  return copy;
}

function timescaleOf(buf: Buffer, header: Box): number {
  return buf.readUInt32BE(header.bodyStart + (buf[header.bodyStart] === 1 ? 20 : 12));
}

interface MergedTrack {
  durations: number[];
  sizes: number[];
  sync: boolean[] | null;
  samplesPerChunk: number[];
  chunkOffsets: number[];
}

function buildStbl(stsd: Buffer, track: MergedTrack): Buffer {
  const stts = runs(track.durations);
  const stsc: number[][] = [];
  let firstChunk = 1;
  for (const [count, perChunk] of runs(track.samplesPerChunk)) {
    stsc.push([firstChunk, perChunk, 1]);
    firstChunk += count;
  }
  const co64 = Buffer.alloc(4 + track.chunkOffsets.length * 8);
  co64.writeUInt32BE(track.chunkOffsets.length);
  track.chunkOffsets.forEach((offset, i) => co64.writeBigUInt64BE(BigInt(offset), 4 + i * 8));
  const syncSamples = track.sync?.flatMap((isSync, i) => (isSync ? [i + 1] : [])) ?? null;
  return box(
    "stbl",
    stsd,
    fullBox("stts", 0, u32s([stts.length, ...stts.flat()])),
    ...(syncSamples ? [fullBox("stss", 0, u32s([syncSamples.length, ...syncSamples]))] : []),
    fullBox("stsc", 0, u32s([stsc.length, ...stsc.flat()])),
    fullBox("stsz", 0, u32s([0, track.sizes.length, ...track.sizes])),
    fullBox("co64", 0, co64),
  );
}

// Only chunk 0's sample entry is kept. Chunks repeat SPS/PPS in-band (`repeat-headers=1`), and
// their entries legitimately differ in per-file fields (x264 frame_num width, esds bitrates).
const codecOf = (track: TrackTable) => track.stsd.toString("latin1", 20, 24);

function assertSameTracks(chunks: readonly TrackTable[][]): void {
  const first = chunks[0]!;
  chunks.forEach((tracks, index) => {
    const same =
      tracks.length === first.length &&
      tracks.every(
        (track, t) =>
          track.handler === first[t]!.handler &&
          track.timescale === first[t]!.timescale &&
          codecOf(track) === codecOf(first[t]!),
      );
    if (!same) throw new Error(`[mp4Stitch] chunk ${index} tracks differ from chunk 0`);
    for (const track of tracks) {
      if (track.handler === "vide" && track.mediaTime !== 0) {
        throw new Error(`[mp4Stitch] chunk ${index} video starts at media time ${track.mediaTime}`);
      }
    }
  });
}

// ftyp + moov + mdat header for the chunks' payloads placed in order after it. The moov is chunk
// 0's with merged sample tables; chunk 0's audio priming skip stays in an edit list.
export function buildStitchedHeader(layouts: readonly Mp4Layout[]): Buffer {
  const chunks = layouts.map((layout) => readTracks(layout.moov));
  assertSameTracks(chunks);
  const payloadBases: number[] = [];
  let payloadBytes = 0;
  for (const layout of layouts) {
    payloadBases.push(payloadBytes);
    payloadBytes += layout.payloadEnd - layout.payloadStart;
  }
  const template = layouts[0]!.moov;
  const root = boxAt(template, 0, 0, template.length);
  const movieTimescale = timescaleOf(template, child(template, root, "mvhd"));

  const buildMoov = (dataStart: number): Buffer => {
    const traks = chunks[0]!.map((track, t) => {
      const parts = chunks.map((tracks) => tracks[t]!);
      const merged: MergedTrack = {
        durations: parts.flatMap((part) => part.durations),
        sizes: parts.flatMap((part) => part.sizes),
        sync: parts.every((part) => !part.sync)
          ? null
          : parts.flatMap((part) => part.sync ?? part.sizes.map(() => true)),
        samplesPerChunk: parts.flatMap((part) => part.samplesPerChunk),
        chunkOffsets: parts.flatMap((part, i) =>
          part.chunkOffsets.map((offset) => {
            const { payloadStart, payloadEnd } = layouts[i]!;
            if (offset < payloadStart || offset >= payloadEnd) {
              throw new Error(`[mp4Stitch] chunk ${i} has samples outside its mdat`);
            }
            return offset - payloadStart + payloadBases[i]! + dataStart;
          }),
        ),
      };
      const mediaDuration = sum(merged.durations);
      const shown = Math.round(
        ((mediaDuration - track.mediaTime) * movieTimescale) / track.timescale,
      );
      const elst = Buffer.alloc(24);
      elst.writeUInt32BE(1);
      elst.writeBigUInt64BE(BigInt(shown), 4);
      elst.writeBigInt64BE(BigInt(track.mediaTime), 12);
      elst.writeUInt32BE(0x00010000, 20);
      // An edit list rounds the shown length to the movie timescale, so write one only to skip
      // leading samples (the AAC priming).
      const edts = track.mediaTime ? box("edts", fullBox("elst", 1, elst)) : Buffer.alloc(0);
      const trak = rebuild(template, track.trak, {
        tkhd: (tkhd) => Buffer.concat([withDuration(template, tkhd, shown), edts]),
        edts: () => Buffer.alloc(0),
        mdia: (mdia) =>
          rebuild(template, mdia, {
            mdhd: (mdhd) => withDuration(template, mdhd, mediaDuration),
            minf: (minf) => rebuild(template, minf, { stbl: () => buildStbl(track.stsd, merged) }),
          }),
      });
      return { trak, shown };
    });
    let next = 0;
    return rebuild(template, root, {
      mvhd: (mvhd) => withDuration(template, mvhd, Math.max(...traks.map((t) => t.shown))),
      trak: () => traks[next++]!.trak,
    });
  };

  const ftyp = layouts[0]!.ftyp;
  const dataStart = ftyp.length + buildMoov(0).length + 16;
  const mdat = Buffer.alloc(16);
  mdat.writeUInt32BE(1);
  mdat.write("mdat", 4, "latin1");
  mdat.writeBigUInt64BE(BigInt(16 + payloadBytes), 8);
  return Buffer.concat([ftyp, buildMoov(dataStart), mdat]);
}

function fileRange(path: string): ReadRange {
  return async (start, end) => {
    const file = await open(path, "r");
    try {
      const buf = Buffer.alloc(end - start);
      const { bytesRead } = await file.read(buf, 0, buf.length, start);
      return buf.subarray(0, bytesRead);
    } finally {
      await file.close();
    }
  };
}

/** Local join: the stitched header, then each chunk's mdat payload in order. */
export async function writeStitchedMp4(
  chunkPaths: readonly string[],
  outputPath: string,
): Promise<void> {
  const layouts = await Promise.all(chunkPaths.map((path) => readMp4Layout(fileRange(path))));
  const out = createWriteStream(outputPath);
  out.write(buildStitchedHeader(layouts));
  for (const [i, path] of chunkPaths.entries()) {
    const { payloadStart, payloadEnd } = layouts[i]!;
    const payload = createReadStream(path, { start: payloadStart, end: payloadEnd - 1 });
    await pipeline(payload, out, { end: false });
  }
  out.end();
  await finished(out);
}
