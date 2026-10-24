// The public `<output>.hf-render.json` receipt. Raw variable values, env vars, host paths and
// usernames stay out, and like the engine's container tags it is a hint, not an authenticity
// boundary. Keep in sync with core/schemas/hf-render-sidecar.json and the render-provenance doc.

import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, rename, rm, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { getFfmpegBinary } from "@hyperframes/engine";
import type { Fps } from "@hyperframes/core";
import type { ProducerLogger } from "../../logger.js";
import { readProducerVersion } from "../distributed/shared.js";
import { canonicalJsonStringify, sha256Hex } from "./stages/planHash.js";

const execFile = promisify(execFileCallback);

// The CLI bundles the producer into its own dist, where the package.json walk cannot find it.
declare const __PRODUCER_VERSION__: string | undefined;

function resolveProducerVersion(): string {
  if (typeof __PRODUCER_VERSION__ === "string" && __PRODUCER_VERSION__.length > 0) {
    return __PRODUCER_VERSION__;
  }
  return readProducerVersion();
}

export const RENDER_SIDECAR_SCHEMA_VERSION = 1 as const;
export const RENDER_SIDECAR_SUFFIX = ".hf-render.json";
export const RENDER_SIDECAR_SCHEMA_URL =
  "https://hyperframes.heygen.com/schema/hf-render-sidecar.json";

/** undefined writes `<output>.hf-render.json`, false disables it, a string relocates it. */
export type ProvenanceSetting = string | false | undefined;

export interface RenderProvenanceSidecar {
  $schema: string;
  schemaVersion: typeof RENDER_SIDECAR_SCHEMA_VERSION;
  kind: "hf-render-sidecar";
  /** ISO-8601 timestamp of sidecar creation (artifact commit time). */
  createdAt: string;
  versions: {
    /** `@hyperframes/producer` package version. */
    producer: string;
    /** Node.js version the render ran on (`process.version`). */
    node: string;
    /** First line of `ffmpeg -version`; absent when the probe failed. */
    ffmpeg?: string;
  };
  render: {
    jobId: string;
    outcome: "completed" | "completed_with_warnings";
    /** Sorted, de-duplicated capture-readiness warning codes. */
    warningCodes: string[];
    totalElapsedMs: number;
    /** Per-stage wall-clock timings (compileMs, captureMs, encodeMs, …). */
    stages: Record<string, number>;
    /** Parallel capture worker count actually used. */
    workers?: number;
    quality: "draft" | "standard" | "high";
  };
  input: {
    /** Project-relative entry HTML path. */
    entryFile: string;
    /** sha256 of the entry HTML source bytes; absent when unreadable. */
    entrySha256?: string;
    /** Content hash of the compiled composition (same value telemetry reports). */
    compositionHash?: string;
    /** Sorted `@font-face` family names baked into the compiled composition. */
    fonts: string[];
    /** Render-time variable overrides, hashed — never the raw values. */
    variables: { count: number; sha256: string } | null;
  };
  output: {
    /** Output file (or directory, for png-sequence and hls) basename. No host paths. */
    file: string;
    format: string;
    fps: { num: number; den: number };
    width?: number;
    height?: number;
    durationSeconds?: number;
    totalFrames?: number;
    /** On-disk size of the committed artifact. File outputs only. */
    sizeBytes?: number;
    /** sha256 of the committed artifact bytes. File outputs only. */
    sha256?: string;
    /** True when the artifact was encoded as HDR. */
    hdr: boolean;
    /** Video encoder facts; null for png-sequence and gif outputs. */
    encoder: { codec: string; preset: string; pixelFormat: string } | null;
  };
  host: { platform: string; arch: string };
}

export function resolveProvenanceSidecarPath(
  outputPath: string,
  provenance: ProvenanceSetting,
): string | null {
  if (provenance === false) return null;
  if (typeof provenance === "string" && provenance.trim() !== "") {
    return resolve(provenance);
  }
  // `resolve` strips a directory output's trailing separator, so the sidecar lands beside it.
  return `${resolve(outputPath)}${RENDER_SIDECAR_SUFFIX}`;
}

// The deterministic-font injector writes plain `font-family: '<name>'` declarations.
export function collectFontFamilies(compiledHtml: string): string[] {
  const families = new Set<string>();
  const fontFace = /@font-face\s*\{[^}]*?font-family\s*:\s*(['"]?)([^'";}]+)\1/g;
  for (const match of compiledHtml.matchAll(fontFace)) {
    const family = match[2]?.trim();
    if (family) families.add(family);
  }
  return [...families].sort();
}

// Hashed, never raw: variables routinely carry user text or tokens.
export function hashVariables(
  variables: Record<string, unknown> | undefined,
): { count: number; sha256: string } | null {
  if (!variables || Object.keys(variables).length === 0) return null;
  // Same normalization as the render request boundary, so direct RenderConfig callers match.
  const normalized: unknown = JSON.parse(JSON.stringify(variables));
  return {
    count: Object.keys(variables).length,
    sha256: sha256Hex(canonicalJsonStringify(normalized)),
  };
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

// A failed probe yields undefined: it must never fail a render that already committed.
let cachedFfmpegVersionLine: string | undefined | null = null;
async function readFfmpegVersionLine(): Promise<string | undefined> {
  if (cachedFfmpegVersionLine !== null) return cachedFfmpegVersionLine;
  try {
    const { stdout } = await execFile(getFfmpegBinary(), ["-version"], {
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    const firstLine = stdout.split(/\r?\n/)[0]?.trim();
    cachedFfmpegVersionLine = firstLine && firstLine.length > 0 ? firstLine : undefined;
  } catch {
    cachedFfmpegVersionLine = undefined;
  }
  return cachedFfmpegVersionLine;
}

export interface BuildRenderProvenanceSidecarInput {
  jobId: string;
  outcome: "completed" | "completed_with_warnings";
  warningCodes: readonly string[];
  totalElapsedMs: number;
  stages: Record<string, number>;
  workers?: number;
  quality: "draft" | "standard" | "high";
  producerVersion: string;
  ffmpegVersion?: string;
  entryFile: string;
  entrySha256?: string;
  compositionHash?: string;
  fonts: readonly string[];
  variables?: Record<string, unknown>;
  outputPath: string;
  format: string;
  fps: Fps;
  width?: number;
  height?: number;
  durationSeconds?: number;
  totalFrames?: number;
  outputSizeBytes?: number;
  outputSha256?: string;
  hdr: boolean;
  encoder: { codec: string; preset: string; pixelFormat: string } | null;
  /** Injectable for deterministic tests; defaults to the current time. */
  createdAt?: string;
}

export function buildRenderProvenanceSidecar(
  input: BuildRenderProvenanceSidecarInput,
): RenderProvenanceSidecar {
  return {
    $schema: RENDER_SIDECAR_SCHEMA_URL,
    schemaVersion: RENDER_SIDECAR_SCHEMA_VERSION,
    kind: "hf-render-sidecar",
    createdAt: input.createdAt ?? new Date().toISOString(),
    versions: {
      producer: input.producerVersion,
      node: process.version,
      ...(input.ffmpegVersion !== undefined && { ffmpeg: input.ffmpegVersion }),
    },
    render: {
      jobId: input.jobId,
      outcome: input.outcome,
      warningCodes: [...new Set(input.warningCodes)].sort(),
      totalElapsedMs: input.totalElapsedMs,
      stages: { ...input.stages },
      ...(input.workers !== undefined && { workers: input.workers }),
      quality: input.quality,
    },
    input: {
      entryFile: input.entryFile,
      ...(input.entrySha256 !== undefined && { entrySha256: input.entrySha256 }),
      ...(input.compositionHash !== undefined && { compositionHash: input.compositionHash }),
      fonts: [...input.fonts],
      variables: hashVariables(input.variables),
    },
    output: {
      file: basename(resolve(input.outputPath)),
      format: input.format,
      fps: { num: input.fps.num, den: input.fps.den },
      ...(input.width !== undefined && { width: input.width }),
      ...(input.height !== undefined && { height: input.height }),
      ...(input.durationSeconds !== undefined && { durationSeconds: input.durationSeconds }),
      ...(input.totalFrames !== undefined && { totalFrames: input.totalFrames }),
      ...(input.outputSizeBytes !== undefined && { sizeBytes: input.outputSizeBytes }),
      ...(input.outputSha256 !== undefined && { sha256: input.outputSha256 }),
      hdr: input.hdr,
      encoder: input.encoder,
    },
    host: { platform: process.platform, arch: process.arch },
  };
}

// The temp file sits beside the destination, not in os.tmpdir(), so the rename is atomic.
async function writeRenderProvenanceSidecar(
  sidecarPath: string,
  sidecar: RenderProvenanceSidecar,
): Promise<void> {
  const tmpPath = `${sidecarPath}.tmp`;
  const handle = await open(tmpPath, "w", 0o644);
  try {
    await handle.writeFile(`${JSON.stringify(sidecar, null, 2)}\n`, "utf-8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmpPath, sidecarPath);
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw error;
  }
}

export interface EmitRenderProvenanceSidecarInput {
  outputPath: string;
  provenance: ProvenanceSetting;
  /** False for png-sequence and hls — directory artifacts skip size + sha256. */
  isFileArtifact: boolean;
  projectDir: string;
  /** Project-relative entry HTML path (`RenderConfig.entryFile` default). */
  entryFile: string;
  /** Compiled composition HTML — scanned for `@font-face` families. */
  compiledHtml: string;
  jobId: string;
  outcome: "completed" | "completed_with_warnings";
  warningCodes: readonly string[];
  totalElapsedMs: number;
  stages: Record<string, number>;
  workers?: number;
  quality: "draft" | "standard" | "high";
  compositionHash?: string;
  variables?: Record<string, unknown>;
  format: string;
  fps: Fps;
  width?: number;
  height?: number;
  durationSeconds?: number;
  totalFrames?: number;
  hdr: boolean;
  encoder: { codec: string; preset: string; pixelFormat: string } | null;
  log: ProducerLogger;
}

async function sha256FileOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await sha256File(path);
  } catch {
    return undefined;
  }
}

/**
 * Build and write the provenance sidecar for a committed render artifact.
 * Returns the sidecar path, or `null` when disabled or when writing failed —
 * the sidecar is a receipt, so a failure here logs a warning and never
 * un-completes a render whose artifact already committed.
 */
export async function emitRenderProvenanceSidecar(
  input: EmitRenderProvenanceSidecarInput,
): Promise<string | null> {
  const sidecarPath = resolveProvenanceSidecarPath(input.outputPath, input.provenance);
  if (sidecarPath === null) return null;
  try {
    const outputStat = input.isFileArtifact
      ? await stat(input.outputPath).catch(() => undefined)
      : undefined;
    const sidecar = buildRenderProvenanceSidecar({
      jobId: input.jobId,
      outcome: input.outcome,
      warningCodes: input.warningCodes,
      totalElapsedMs: input.totalElapsedMs,
      stages: input.stages,
      workers: input.workers,
      quality: input.quality,
      producerVersion: resolveProducerVersion(),
      ffmpegVersion: await readFfmpegVersionLine(),
      entryFile: input.entryFile,
      entrySha256: await sha256FileOrUndefined(join(input.projectDir, input.entryFile)),
      compositionHash: input.compositionHash,
      fonts: collectFontFamilies(input.compiledHtml),
      variables: input.variables,
      outputPath: input.outputPath,
      format: input.format,
      fps: input.fps,
      width: input.width,
      height: input.height,
      durationSeconds: input.durationSeconds,
      totalFrames: input.totalFrames,
      outputSizeBytes: outputStat?.size,
      outputSha256: input.isFileArtifact
        ? await sha256FileOrUndefined(input.outputPath)
        : undefined,
      hdr: input.hdr,
      encoder: input.encoder,
    });
    await writeRenderProvenanceSidecar(sidecarPath, sidecar);
    input.log.info("Render provenance sidecar written", { sidecarPath });
    return sidecarPath;
  } catch (error) {
    input.log.warn("Failed to write render provenance sidecar", {
      sidecarPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
