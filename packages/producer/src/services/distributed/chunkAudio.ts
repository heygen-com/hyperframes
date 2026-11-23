// Distributed mp4 chunks can carry their own slice of the plan audio: the AAC packets of the one
// plan-wide encode that start inside the chunk's frame range, so the chunks' audio has no seams.

import { closeSync, existsSync, ftruncateSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { Fps } from "@hyperframes/core";
import { appendRenderProvenanceArgs, describeFfmpegFailure, runFfmpeg } from "@hyperframes/engine";
import { runFfprobeJson } from "../render/audioPadTrim.js";
import type { ChunkSliceJson } from "../render/stages/freezePlan.js";
import { fileRange, readMp4Layout, readTracks } from "./mp4Stitch.js";
import { resolvePlanAudioPath } from "./shared.js";

/** Where AAC packet `j` of the plan audio starts: `firstStart + j * packetSamples`, in samples. */
interface AacPacketGrid {
  sampleRate: number;
  firstStart: number;
  packetSamples: number;
  packetCount: number;
}

/** Input-side `-ss` / `-t` that select exactly packets `[first, end)` for one chunk. */
interface AudioCut {
  seekSeconds: number | null;
  durationSeconds: number | null;
  firstPacket: number;
  packetCount: number;
}

// A chunk owns the packets starting in its frame range (chunk 0 also the priming before 0).
// Cuts sit half a packet before a packet start so ffmpeg's rounding cannot move them.
export function audioCutForChunk(
  grid: AacPacketGrid,
  chunks: readonly ChunkSliceJson[],
  index: number,
  fps: Fps,
): AudioCut | null {
  const firstPacketAt = (frame: number): number =>
    Math.min(
      grid.packetCount,
      Math.max(
        0,
        Math.ceil(
          (frame * fps.den * grid.sampleRate - grid.firstStart * fps.num) /
            (grid.packetSamples * fps.num),
        ),
      ),
    );
  const first = index === 0 ? 0 : firstPacketAt(chunks[index]!.startFrame);
  const end =
    index === chunks.length - 1 ? grid.packetCount : firstPacketAt(chunks[index + 1]!.startFrame);
  if (end <= first) return null;
  const cutSeconds = (packet: number): number =>
    (grid.firstStart + packet * grid.packetSamples - grid.packetSamples / 2) / grid.sampleRate;
  const seekSeconds = index === 0 ? null : cutSeconds(first);
  const durationSeconds = end === grid.packetCount ? null : cutSeconds(end) - (seekSeconds ?? 0);
  return { seekSeconds, durationSeconds, firstPacket: first, packetCount: end - first };
}

/** Chunk `index` split around `range`, so `audioCutForChunk` treats `range` as a chunk. */
export function chunksWithSubRange(
  chunks: readonly ChunkSliceJson[],
  index: number,
  range: { startFrame: number; endFrame: number },
): { chunks: ChunkSliceJson[]; index: number } {
  const slice = chunks[index]!;
  const parts = [
    { startFrame: slice.startFrame, endFrame: range.startFrame },
    range,
    { startFrame: range.endFrame, endFrame: slice.endFrame },
  ].filter((part) => part.endFrame > part.startFrame);
  const split = [...chunks.slice(0, index), ...parts, ...chunks.slice(index + 1)].map(
    (chunk, i) => ({ index: i, startFrame: chunk.startFrame, endFrame: chunk.endFrame }),
  );
  return { chunks: split, index: range.startFrame > slice.startFrame ? index + 1 : index };
}

interface FfprobeAudioGrid {
  streams?: { sample_rate?: string; time_base?: string; nb_frames?: string }[];
  packets?: { pts?: number; duration?: number }[];
}

async function probeAacPacketGrid(audioPath: string): Promise<AacPacketGrid> {
  const probe = await runFfprobeJson<FfprobeAudioGrid>([
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=sample_rate,time_base,nb_frames:packet=pts,duration",
    "-read_intervals",
    "%+#1",
    "-of",
    "json",
    "--",
    audioPath,
  ]);
  const stream = probe.streams?.[0] ?? {};
  const packet = probe.packets?.[0] ?? {};
  const sampleRate = Number(stream.sample_rate);
  const [tbNum = NaN, tbDen = NaN] = String(stream.time_base).split("/").map(Number);
  const toSamples = (ticks?: number): number => (Number(ticks) * sampleRate * tbNum) / tbDen;
  const grid = {
    sampleRate,
    firstStart: toSamples(packet.pts),
    packetSamples: toSamples(packet.duration),
    packetCount: Number(stream.nb_frames),
  };
  const counts = [grid.sampleRate, grid.packetSamples, grid.packetCount];
  if (!Number.isFinite(grid.firstStart) || !counts.every((n) => Number.isFinite(n) && n > 0)) {
    throw new Error(`[chunkAudio] could not read the AAC packet grid: ${JSON.stringify(probe)}`);
  }
  return grid;
}

// A sliced plan keeps the audio's moov once, in `frame.m4a` (the file minus its mdat payload),
// and each chunk's packet bytes in their own file. A chunk rebuilds a sparse copy of the whole
// file from them, so it runs the same cut on the same moov and bytes in any ffmpeg version.
const SLICE_DIR = "audio-chunks";
const SLICE_FRAME = `${SLICE_DIR}/frame.m4a`;
const SLICE_LAYOUT = `${SLICE_DIR}/layout.json`;

interface SliceLayout {
  sizeBytes: number;
  payloadStart: number;
  payloadEnd: number;
  partStarts: Record<string, number>;
}

export function chunkAudioSlicePath(index: number): string {
  return `${SLICE_DIR}/${String(index).padStart(4, "0")}.bin`;
}

/** Which chunks need a sliced-audio file: `"all"`, one index, or `null` if it is not one. */
export function chunkAudioSliceTarget(path: string): "all" | number | null {
  if (path === SLICE_FRAME || path === SLICE_LAYOUT) return "all";
  const match = /^audio-chunks\/(\d{4,})\.bin$/.exec(path);
  return match ? Number(match[1]) : null;
}

export async function writeChunkAudioSlices(input: {
  audioPath: string;
  planDir: string;
  chunks: readonly ChunkSliceJson[];
  fps: Fps;
}): Promise<void> {
  const grid = await probeAacPacketGrid(input.audioPath);
  const { payloadStart, payloadEnd, moov } = await readMp4Layout(fileRange(input.audioPath));
  const [track] = readTracks(moov);
  const offsets: number[] = [];
  track!.chunkOffsets.forEach((offset, chunk) => {
    for (let i = 0; i < track!.samplesPerChunk[chunk]!; i++) {
      offsets.push(offset);
      offset += track!.sizes[offsets.length - 1]!;
    }
  });
  const bytes = readFileSync(input.audioPath);
  const layout: SliceLayout = { sizeBytes: bytes.length, payloadStart, payloadEnd, partStarts: {} };
  mkdirSync(join(input.planDir, SLICE_DIR), { recursive: true });
  input.chunks.forEach((_, index) => {
    const cut = audioCutForChunk(grid, input.chunks, index, input.fps);
    if (!cut) return;
    const last = cut.firstPacket + cut.packetCount - 1;
    const start = offsets[cut.firstPacket]!;
    layout.partStarts[index] = start;
    const end = offsets[last]! + track!.sizes[last]!;
    writeFileSync(join(input.planDir, chunkAudioSlicePath(index)), bytes.subarray(start, end));
  });
  const frame = [bytes.subarray(0, payloadStart), bytes.subarray(payloadEnd)];
  writeFileSync(join(input.planDir, SLICE_FRAME), Buffer.concat(frame));
  writeFileSync(join(input.planDir, SLICE_LAYOUT), JSON.stringify(layout));
}

/** The plan audio for a chunk: the whole file, or one rebuilt at `scratchPath` from its slice. */
export function chunkAudioSource(
  planDir: string,
  chunkIndex: number,
  scratchPath: string,
): string | null {
  const layoutPath = join(planDir, SLICE_LAYOUT);
  if (!existsSync(layoutPath)) return resolvePlanAudioPath(planDir);
  const layout = JSON.parse(readFileSync(layoutPath, "utf-8")) as SliceLayout;
  const frame = readFileSync(join(planDir, SLICE_FRAME));
  const fd = openSync(scratchPath, "w");
  try {
    writeSync(fd, frame, 0, layout.payloadStart, 0);
    writeSync(
      fd,
      frame,
      layout.payloadStart,
      frame.length - layout.payloadStart,
      layout.payloadEnd,
    );
    const start = layout.partStarts[chunkIndex];
    if (start !== undefined) {
      const part = readFileSync(join(planDir, chunkAudioSlicePath(chunkIndex)));
      writeSync(fd, part, 0, part.length, start);
    }
    ftruncateSync(fd, layout.sizeBytes);
  } finally {
    closeSync(fd);
  }
  return scratchPath;
}

interface MuxInput {
  videoPath: string;
  audioPath: string | null;
  outputPath: string;
  chunks: readonly ChunkSliceJson[];
  chunkIndex: number;
  fps: Fps;
  signal?: AbortSignal;
  timeoutMs: number;
}

function chunkMuxArgs(input: MuxInput, cut: AudioCut | null): string[] {
  if (!cut) return ["-i", input.videoPath, "-map", "0:v:0"];
  const seek = cut.seekSeconds === null ? [] : ["-ss", cut.seekSeconds.toFixed(6)];
  const length = cut.durationSeconds === null ? [] : ["-t", cut.durationSeconds.toFixed(6)];
  // A seek keeps the packet before the cut unless told not to; chunk 0 never
  // seeks, so its priming packet (and the edit list that hides it) survive.
  const exact = seek.length ? ["-copypriorss", "0"] : [];
  return [
    ...["-i", input.videoPath, ...seek, ...length, "-i", input.audioPath!],
    ...["-map", "0:v:0", "-map", "1:a:0", ...exact],
  ];
}

/** Mux one encoded chunk with the plan audio packets it owns into a regular mp4 at `outputPath`. */
export async function muxChunkWithAudio(input: MuxInput): Promise<void> {
  const grid = input.audioPath ? await probeAacPacketGrid(input.audioPath) : null;
  const cut = grid ? audioCutForChunk(grid, input.chunks, input.chunkIndex, input.fps) : null;
  const args = [...chunkMuxArgs(input, cut), "-c", "copy"];
  appendRenderProvenanceArgs(args, input.outputPath);
  args.push("-y", input.outputPath);
  const result = await runFfmpeg(args, { signal: input.signal, timeout: input.timeoutMs });
  if (!result.success) {
    throw new Error(
      `[chunkAudio] chunk mux failed: ${describeFfmpegFailure(result, input.timeoutMs)}`,
    );
  }
  const slice = input.chunks[input.chunkIndex]!;
  const expected: Record<string, number> = { video: slice.endFrame - slice.startFrame };
  if (cut) expected.audio = cut.packetCount;
  const probe = await runFfprobeJson<{
    streams?: { codec_type?: string; nb_read_packets?: string }[];
  }>([
    "-v",
    "error",
    "-count_packets",
    "-show_entries",
    "stream=codec_type,nb_read_packets",
    "-of",
    "json",
    "--",
    input.outputPath,
  ]);
  for (const [type, count] of Object.entries(expected)) {
    const packets = Number(probe.streams?.find((s) => s.codec_type === type)?.nb_read_packets ?? 0);
    if (packets !== count) {
      throw new Error(`[chunkAudio] ${type} packets in chunk ${packets}, expected ${count}`);
    }
  }
}
