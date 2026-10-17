// Distributed mp4 chunks can carry their own slice of the plan audio: the AAC packets of the one
// plan-wide encode that start inside the chunk's frame range, so the chunks' audio has no seams.

import type { Fps } from "@hyperframes/core";
import { appendRenderProvenanceArgs, describeFfmpegFailure, runFfmpeg } from "@hyperframes/engine";
import { runFfprobeJson } from "../render/audioPadTrim.js";
import type { ChunkSliceJson } from "../render/stages/freezePlan.js";

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
