/**
 * AAC for the mixed 48 kHz audio. One encoder is single-threaded (about 60x real time),
 * so long audio is encoded as frame-aligned segments in parallel and their frames joined.
 */

import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { removeScratch } from "@hyperframes/core/remove-scratch";
import { dirname, join } from "node:path";
import { getFfmpegBinary } from "../utils/ffmpegBinaries.js";
import { runFfmpeg, type RunFfmpegResult } from "../utils/runFfmpeg.js";

const SAMPLE_RATE = 48_000;
const FRAME_SAMPLES = 1024;
const MIN_SEGMENT_SECONDS = 60;
// Fixed rather than the core count, so the bytes (and the planHash) do not depend on the machine.
const MAX_SEGMENTS = 8;
// Encoded around each segment and dropped: rate control settles over ~10 s, and opening cold on
// quiet sound codes the first loud frame up to 4.5 dB hot, so the first segment opens in silence.
const PRE_ROLL_FRAMES = 469;
const POST_ROLL_FRAMES = 8;
const AAC_ARGS = ["-acodec", "aac", "-b:a", "192k"];

export function aacSegmentCount(totalDuration: number): number {
  return Math.max(1, Math.min(MAX_SEGMENTS, Math.floor(totalDuration / MIN_SEGMENT_SECONDS)));
}

export function splitAdtsFrames(bytes: Buffer): Buffer[] {
  const frames: Buffer[] = [];
  for (let at = 0; at < bytes.length; ) {
    const length = ((bytes[at + 3]! & 0x03) << 11) | (bytes[at + 4]! << 3) | (bytes[at + 5]! >> 5);
    if (bytes[at] !== 0xff || (bytes[at + 1]! & 0xf0) !== 0xf0 || length < 7) {
      throw new Error(`Not an ADTS frame at byte ${at}`);
    }
    frames.push(bytes.subarray(at, at + length));
    at += length;
  }
  return frames;
}

/**
 * Packet g of the stream covers samples [(g-1)*1024, (g+1)*1024); packet 0 is the
 * encoder delay. Segment k encodes from `firstFrame` and keeps its packets [keepFrom, keepTo).
 */
function planSegments(totalDuration: number, count: number) {
  // Round to whole samples first: 147.52 * 48000 is 7080960.000000001 in floating point.
  const packets = Math.ceil(Math.round(totalDuration * SAMPLE_RATE) / FRAME_SAMPLES) + 1;
  const cuts = Array.from({ length: count + 1 }, (_, k) => Math.round((k * packets) / count));
  return cuts.slice(0, -1).map((cut, k) => {
    const next = cuts[k + 1]!;
    const firstFrame = cut - PRE_ROLL_FRAMES;
    const end = k === count - 1 ? "" : `end_sample=${(next + POST_ROLL_FRAMES) * FRAME_SAMPLES}`;
    const trim =
      firstFrame < 0
        ? `${end && `atrim=${end},`}adelay=delays=${-firstFrame * FRAME_SAMPLES}S:all=1`
        : `atrim=start_sample=${firstFrame * FRAME_SAMPLES}${end && `:${end}`}`;
    return { trim, keepFrom: cut - firstFrame, keepTo: next - firstFrame };
  });
}

const settsDurationSupport = new Map<string, Promise<boolean>>();

/** FFmpeg before 5.0 (Ubuntu 22.04 ships 4.4) has no `duration` option on the setts filter. */
function supportsSettsDuration(binary = getFfmpegBinary()): Promise<boolean> {
  let supported = settsDurationSupport.get(binary);
  if (!supported) {
    supported = new Promise((resolve) => {
      execFile(
        binary,
        ["-hide_banner", "-h", "bsf=setts"],
        { windowsHide: true },
        (error, stdout) => {
          // A binary that cannot even print help fails the encode with its own error, not this one.
          resolve(error !== null || stdout.includes("duration"));
        },
      );
    });
    settsDurationSupport.set(binary, supported);
  }
  return supported;
}

function encodeInOnePass(
  input: string,
  outputPath: string,
  { signal, timeout, filter }: { signal?: AbortSignal; timeout: number; filter?: string },
): Promise<RunFfmpegResult> {
  const filters = [filter, `aresample=${SAMPLE_RATE}`].filter(Boolean).join(",");
  return runFfmpeg(["-i", input, "-af", filters, ...AAC_ARGS, "-y", outputPath], {
    signal,
    timeout,
  });
}

/** `input`, after `filter`, is audio of exactly `totalDuration`. */
export async function encodeAac(
  input: string,
  outputPath: string,
  totalDuration: number,
  {
    signal,
    timeout,
    filter,
    segments: count = aacSegmentCount(totalDuration),
  }: { signal?: AbortSignal; timeout: number; filter?: string; segments?: number },
): Promise<RunFfmpegResult> {
  if (!(await supportsSettsDuration())) {
    return encodeInOnePass(input, outputPath, { signal, timeout, filter });
  }
  const dir = mkdtempSync(join(dirname(outputPath), ".aac-segments-"));
  try {
    const segments = planSegments(totalDuration, count).map((segment, k) => ({
      ...segment,
      path: join(dir, `${k}.aac`),
    }));
    const results = await Promise.all(
      segments.map(({ trim, path }) =>
        runFfmpeg(
          [
            "-cpuflags",
            "0",
            "-i",
            input,
            "-af",
            [filter, `aresample=${SAMPLE_RATE}`, trim].filter(Boolean).join(","),
            ...AAC_ARGS,
            "-f",
            "adts",
            "-y",
            path,
          ],
          {
            signal,
            timeout,
          },
        ),
      ),
    );
    const failed = results.find((result) => !result.success);
    if (failed) return failed;

    const joined = join(dir, "joined.aac");
    const frames = segments.flatMap(({ path, keepFrom, keepTo }) => {
      const segmentFrames = splitAdtsFrames(readFileSync(path));
      if (segmentFrames.length < keepTo) {
        throw new Error(`AAC segment ${path} has ${segmentFrames.length} frames, needs ${keepTo}`);
      }
      return segmentFrames.slice(keepFrom, keepTo);
    });
    writeFileSync(joined, Buffer.concat(frames));
    // ADTS carries neither the encoder delay nor the last packet's short duration: the offset
    // restores the delay, and setts ends the stream at totalDuration as one encoder would.
    const offset = String(-FRAME_SAMPLES / SAMPLE_RATE);
    const end = `setts=duration='if(gte((PTS+DURATION)*TB,${totalDuration}),round(${totalDuration}/TB-PTS),DURATION)'`;
    const muxed = await runFfmpeg(
      [
        "-itsoffset",
        offset,
        "-f",
        "aac",
        "-i",
        joined,
        "-c",
        "copy",
        "-bsf:a",
        end,
        "-y",
        outputPath,
      ],
      { signal, timeout },
    );
    const slowest = Math.max(...results.map((result) => result.durationMs));
    return { ...muxed, durationMs: slowest + muxed.durationMs };
  } finally {
    removeScratch(dir);
  }
}
