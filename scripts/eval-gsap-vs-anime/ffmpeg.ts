import { spawnSync } from "node:child_process";
import type { CheckpointPsnr } from "./types.ts";

type VideoMetadata = {
  durationSeconds: number;
  fps: number;
};

export function computePsnrCheckpoints(input: {
  candidateVideo: string;
  baselineVideo: string;
  checkpointCount: number;
  fps?: number;
}): CheckpointPsnr[] {
  const candidate = probeVideo(input.candidateVideo);
  const baseline = probeVideo(input.baselineVideo);
  const fps = input.fps ?? candidate.fps ?? baseline.fps;
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error("Unable to resolve video fps for PSNR comparison");
  }

  const duration = Math.min(candidate.durationSeconds, baseline.durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Unable to resolve positive video duration for PSNR comparison");
  }

  const count = Math.max(1, Math.floor(input.checkpointCount));
  const sampleDuration = Math.max(0, duration - 1 / fps);
  const checkpoints: CheckpointPsnr[] = [];
  for (let index = 0; index < count; index += 1) {
    const timeSeconds = (sampleDuration * index) / count;
    checkpoints.push(
      psnrAtTime(input.candidateVideo, input.baselineVideo, index, timeSeconds, fps),
    );
  }
  return checkpoints;
}

export function computePsnrForExistingCheckpoints(input: {
  candidateVideo: string;
  baselineVideo: string;
  checkpoints: Pick<CheckpointPsnr, "index" | "time_seconds">[];
  fps: number;
}): CheckpointPsnr[] {
  return input.checkpoints.map((checkpoint) =>
    psnrAtTime(
      input.candidateVideo,
      input.baselineVideo,
      checkpoint.index,
      checkpoint.time_seconds,
      input.fps,
    ),
  );
}

export function probeVideo(path: string): VideoMetadata {
  const result = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=duration,avg_frame_rate,r_frame_rate:format=duration",
      "-of",
      "json",
      path,
    ],
    { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || `ffprobe failed for ${path}`);
  }
  const parsed: unknown = JSON.parse(result.stdout);
  const stream = firstVideoStream(parsed);
  const format = isRecord(parsed) && isRecord(parsed.format) ? parsed.format : null;
  const duration =
    finitePositiveNumber(stream?.duration) ?? finitePositiveNumber(format?.duration) ?? null;
  const fps = parseFps(stream?.avg_frame_rate) ?? parseFps(stream?.r_frame_rate) ?? 30;
  if (duration === null) {
    throw new Error(`ffprobe did not report a positive duration for ${path}`);
  }
  return { durationSeconds: duration, fps };
}

function psnrAtTime(
  candidateVideo: string,
  baselineVideo: string,
  index: number,
  timeSeconds: number,
  fps: number,
): CheckpointPsnr {
  const frameIndex = Math.max(0, Math.round(timeSeconds * fps));
  const filter = `[0:v]select='eq(n\\,${frameIndex})',setpts=PTS-STARTPTS[candidate];[1:v]select='eq(n\\,${frameIndex})',setpts=PTS-STARTPTS[baseline];[candidate][baseline]psnr`;
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "info",
      "-i",
      candidateVideo,
      "-i",
      baselineVideo,
      "-filter_complex",
      filter,
      "-frames:v",
      "1",
      "-f",
      "null",
      "-",
    ],
    {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 256 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || `ffmpeg PSNR failed at ${timeSeconds}s`);
  }
  return {
    index,
    time_seconds: timeSeconds,
    frame_index: frameIndex,
    psnr: parsePsnr(result.stderr, timeSeconds),
  };
}

function parsePsnr(stderr: string, timeSeconds: number): number {
  const match = stderr.match(/average:\s*([^\s]+)/i);
  if (!match) {
    throw new Error(`Unable to parse PSNR output at ${timeSeconds}s`);
  }
  const raw = (match[1] ?? "").trim().toLowerCase();
  if (raw === "inf" || raw === "infinite") return Number.POSITIVE_INFINITY;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid PSNR value at ${timeSeconds}s: ${match[1]}`);
  }
  return parsed;
}

function firstVideoStream(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || !Array.isArray(value.streams)) return null;
  for (const stream of value.streams) {
    if (isRecord(stream)) return stream;
  }
  return null;
}

function parseFps(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "" || value === "0/0") return null;
  const [numRaw, denRaw] = value.split("/");
  const num = Number(numRaw);
  const den = denRaw === undefined ? 1 : Number(denRaw);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null;
  const fps = num / den;
  return Number.isFinite(fps) && fps > 0 ? fps : null;
}

function finitePositiveNumber(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
