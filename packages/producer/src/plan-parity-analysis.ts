import { createHash } from "node:crypto";
import { createReadStream, readdirSync, statSync, type Dirent } from "node:fs";
import { relative, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import type {
  PlanParityDriverResult,
  PlanParityMediaMeasurement,
  PlanParityMeasurement,
  PlanParityStreamMetadata,
} from "./plan-parity-contract.js";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value !== "N/A" ? value : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.length === 0 || value === "N/A") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerValue(value: unknown): number | null {
  const parsed = numberValue(value);
  return parsed === null || !Number.isInteger(parsed) ? null : parsed;
}

function requireCommandSuccess(
  command: string,
  args: string[],
  maxBuffer = 64 * 1024 * 1024,
): Buffer {
  const result = spawnSync(command, args, {
    encoding: "buffer",
    maxBuffer,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} exited ${result.status}: ${result.stderr.toString("utf-8").trim()}`,
    );
  }
  return result.stdout;
}

export function parseCanonicalFrameHashes(framemd5: string): string[] {
  const hashes: string[] = [];
  for (const line of framemd5.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const columns = trimmed.split(",").map((column) => column.trim());
    const hash = columns.at(-1);
    if (!hash || !/^[a-f0-9]{64}$/iu.test(hash)) {
      throw new Error(`unexpected framemd5 row: ${line}`);
    }
    hashes.push(hash.toLowerCase());
  }
  if (hashes.length === 0) {
    throw new Error("ffmpeg produced no decoded video frame hashes");
  }
  return hashes;
}

export function normalizeFfprobeMetadata(value: unknown): PlanParityStreamMetadata {
  if (!isRecord(value)) throw new Error("ffprobe output must be a JSON object");
  const rawStreams = value.streams;
  if (!Array.isArray(rawStreams)) throw new Error("ffprobe output has no streams array");
  const streams = rawStreams.filter(isRecord);
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const format = isRecord(value.format) ? value.format : {};
  const durationSeconds =
    numberValue(format.duration) ??
    Math.max(0, ...streams.map((stream) => numberValue(stream.duration) ?? 0));

  return {
    video: video
      ? {
          codecName: stringValue(video.codec_name),
          width: integerValue(video.width) ?? 0,
          height: integerValue(video.height) ?? 0,
          pixelFormat: stringValue(video.pix_fmt),
          averageFrameRate: stringValue(video.avg_frame_rate),
          realFrameRate: stringValue(video.r_frame_rate),
          frameCount: integerValue(video.nb_frames),
          colorSpace: stringValue(video.color_space),
          colorTransfer: stringValue(video.color_transfer),
          colorPrimaries: stringValue(video.color_primaries),
        }
      : null,
    audio: audio
      ? {
          codecName: stringValue(audio.codec_name),
          sampleRate: integerValue(audio.sample_rate),
          channels: integerValue(audio.channels),
          channelLayout: stringValue(audio.channel_layout),
        }
      : null,
    durationSeconds,
  };
}

function probeMetadata(outputPath: string): PlanParityStreamMetadata {
  const bytes = requireCommandSuccess("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    [
      "format=duration",
      "stream=codec_type,codec_name,width,height,pix_fmt,avg_frame_rate,r_frame_rate,nb_frames",
      "stream=color_space,color_transfer,color_primaries,sample_rate,channels,channel_layout,duration",
    ].join(":"),
    "-of",
    "json",
    outputPath,
  ]);
  return normalizeFfprobeMetadata(JSON.parse(bytes.toString("utf-8")) as unknown);
}

function canonicalFrameHashes(outputPath: string): string[] {
  const bytes = requireCommandSuccess(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      outputPath,
      "-map",
      "0:v:0",
      "-an",
      "-pix_fmt",
      "rgba",
      "-hash",
      "sha256",
      "-f",
      "framemd5",
      "-",
    ],
    256 * 1024 * 1024,
  );
  return parseCanonicalFrameHashes(bytes.toString("utf-8"));
}

async function hashFile(path: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(buffer);
    bytes += buffer.length;
  }
  return { sha256: hash.digest("hex"), bytes };
}

function walkFiles(root: string, current = root): Array<{ absolute: string; relative: string }> {
  const entries: Dirent[] = readdirSync(current, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const files: Array<{ absolute: string; relative: string }> = [];
  for (const entry of entries) {
    const absolute = resolve(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(root, absolute));
    } else if (entry.isFile()) {
      files.push({ absolute, relative: relative(root, absolute).replaceAll("\\", "/") });
    }
  }
  return files;
}

async function hashPath(path: string): Promise<{ sha256: string; bytes: number }> {
  const stat = statSync(path);
  if (stat.isFile()) return hashFile(path);
  if (!stat.isDirectory()) throw new Error(`cannot hash non-file artifact ${path}`);

  const hash = createHash("sha256");
  let bytes = 0;
  for (const file of walkFiles(path)) {
    const digest = await hashFile(file.absolute);
    hash.update(file.relative);
    hash.update("\0");
    hash.update(digest.sha256);
    hash.update("\0");
    bytes += digest.bytes;
  }
  return { sha256: hash.digest("hex"), bytes };
}

async function canonicalPcmAudio(
  outputPath: string,
): Promise<PlanParityMediaMeasurement["pcmAudio"]> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        outputPath,
        "-map",
        "0:a:0",
        "-vn",
        "-ac",
        "2",
        "-ar",
        "48000",
        "-f",
        "s16le",
        "-",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const hash = createHash("sha256");
    const stderr: Buffer[] = [];
    let bytes = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      hash.update(chunk);
      bytes += chunk.length;
    });
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        const message = Buffer.concat(stderr).toString("utf-8");
        // A video-only fixture is a valid parity input. ffmpeg uses this
        // wording when the optional audio map has no match.
        if (/matches no streams|does not contain any stream/iu.test(message)) {
          resolvePromise(null);
          return;
        }
        reject(new Error(`ffmpeg PCM decode exited ${code}: ${message.trim()}`));
        return;
      }
      if (bytes % 4 !== 0) {
        reject(new Error(`canonical stereo s16le byte count ${bytes} is not divisible by 4`));
        return;
      }
      resolvePromise({
        sha256: hash.digest("hex"),
        sampleCount: bytes / 4,
        bytes,
      });
    });
  });
}

export async function analyzePlanParityDriverResult(
  driverName: string,
  result: PlanParityDriverResult,
): Promise<PlanParityMeasurement> {
  const output = await hashPath(result.outputPath);
  const metadata = probeMetadata(result.outputPath);
  const [pcmAudio, frameSha256] = await Promise.all([
    metadata.audio ? canonicalPcmAudio(result.outputPath) : Promise.resolve(null),
    Promise.resolve(canonicalFrameHashes(result.outputPath)),
  ]);

  const chunks = [];
  for (const chunk of [...result.chunks].sort((left, right) => left.index - right.index)) {
    const digest = await hashPath(chunk.path);
    if (
      chunk.reportedSha256 !== undefined &&
      chunk.reportedSha256.toLowerCase() !== digest.sha256
    ) {
      throw new Error(
        `chunk ${chunk.index} digest mismatch: adapter reported ${chunk.reportedSha256}, measured ${digest.sha256}`,
      );
    }
    chunks.push({
      index: chunk.index,
      sha256: digest.sha256,
      bytes: digest.bytes,
      reportedSha256: chunk.reportedSha256,
    });
  }
  const downloaded = result.transferBytes.downloaded;
  const uploaded = result.transferBytes.uploaded;

  return {
    protocol: result.protocol,
    driver: driverName,
    media: {
      outputSha256: output.sha256,
      outputBytes: output.bytes,
      frameSha256,
      pcmAudio,
      metadata,
    },
    chunks,
    transferBytes: {
      downloaded,
      uploaded,
      total: downloaded + uploaded,
    },
    peakMaterializedBytes: result.peakMaterializedBytes,
  };
}
