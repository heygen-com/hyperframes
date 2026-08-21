/**
 * Protocol-neutral contract for comparing distributed render plans.
 *
 * The comparator intentionally has no `planHash` field. v1 and v2 use
 * different artifact layouts and hash schemas, so their plan hashes are not
 * expected to match even when they render identical output.
 */

export type PlanParityProtocol = "v1" | "v2";

export interface PlanParityRenderConfig {
  fps: 24 | 30 | 60;
  width: number;
  height: number;
  format: "mp4";
  chunkSize?: number;
  maxParallelChunks?: number;
}

export interface PlanParityDriverInput {
  protocol: PlanParityProtocol;
  projectDir: string;
  outputDir: string;
  renderConfig: PlanParityRenderConfig;
  /**
   * Test-only plan limit. The Lambda-local driver forwards this to v1 as
   * `planDirSizeLimitBytes`; v2 ignores it because it does not materialize a
   * monolithic plan directory.
   */
  planSizeCapBytes?: number;
}

export interface PlanParityChunkArtifact {
  index: number;
  path: string;
  /** Adapter-reported digest, retained for diagnostics. */
  reportedSha256?: string;
}

export interface PlanParityDriverResult {
  protocol: PlanParityProtocol;
  outputPath: string;
  chunks: PlanParityChunkArtifact[];
  transferBytes: {
    downloaded: number;
    uploaded: number;
  };
  /**
   * Maximum materialized bytes observed in the worker scratch directory.
   * This is distinct from S3 storage and from process RSS.
   */
  peakMaterializedBytes: number;
}

export interface PlanParityDriver {
  readonly name: string;
  render(input: PlanParityDriverInput): Promise<PlanParityDriverResult>;
}

export interface PlanParityStreamMetadata {
  video: {
    codecName: string | null;
    width: number;
    height: number;
    pixelFormat: string | null;
    averageFrameRate: string | null;
    realFrameRate: string | null;
    frameCount: number | null;
    colorSpace: string | null;
    colorTransfer: string | null;
    colorPrimaries: string | null;
  } | null;
  audio: {
    codecName: string | null;
    sampleRate: number | null;
    channels: number | null;
    channelLayout: string | null;
  } | null;
  durationSeconds: number;
}

export interface PlanParityMediaMeasurement {
  outputSha256: string;
  outputBytes: number;
  frameSha256: string[];
  pcmAudio: {
    sha256: string;
    /**
     * Interleaved audio frames after canonical decoding to signed 16-bit,
     * 48 kHz, stereo PCM. One sample frame contains two channel samples.
     */
    sampleCount: number;
    bytes: number;
  } | null;
  metadata: PlanParityStreamMetadata;
}

export interface PlanParityChunkMeasurement {
  index: number;
  sha256: string;
  bytes: number;
  reportedSha256?: string;
}

export interface PlanParityMeasurement {
  protocol: PlanParityProtocol;
  driver: string;
  media: PlanParityMediaMeasurement;
  chunks: PlanParityChunkMeasurement[];
  transferBytes: {
    downloaded: number;
    uploaded: number;
    total: number;
  };
  peakMaterializedBytes: number;
}

export interface PlanParityComparisonOptions {
  /** ffprobe duration tolerance. Defaults to 1 ms. */
  durationToleranceSeconds?: number;
  /**
   * Encoded containers can contain non-semantic metadata. Default false:
   * report output digest/size without requiring byte-identical containers.
   */
  requireEncodedOutputEquality?: boolean;
  /** Optional ceiling applied independently to the v2 run. */
  maxV2TransferBytes?: number;
  /** Optional ceiling applied independently to the v2 run. */
  maxV2PeakMaterializedBytes?: number;
}

export interface PlanParityCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface PlanParityComparison {
  passed: boolean;
  checks: PlanParityCheck[];
  v1: PlanParityMeasurement;
  v2: PlanParityMeasurement;
}

function check(name: string, passed: boolean, detail: string): PlanParityCheck {
  return { name, passed, detail };
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function comparableMetadata(
  metadata: PlanParityStreamMetadata,
): Omit<PlanParityStreamMetadata, "durationSeconds"> {
  return {
    video: metadata.video,
    audio: metadata.audio,
  };
}

/**
 * Compare semantic render output plus transport/resource measurements.
 *
 * `outputBytes`, transfer bytes, and working-set bytes are always surfaced.
 * They are not equality gates by default: v2 is expected to change artifact
 * packaging, and encoded containers may carry non-semantic differences.
 */
// This function is intentionally an exhaustive, flat contract checklist. Each
// branch emits a distinct diagnostic needed to root-cause parity failures.
// fallow-ignore-next-line complexity
export function comparePlanParityMeasurements(
  v1: PlanParityMeasurement,
  v2: PlanParityMeasurement,
  options: PlanParityComparisonOptions = {},
): PlanParityComparison {
  if (v1.protocol !== "v1" || v2.protocol !== "v2") {
    throw new Error(
      `plan parity requires ordered v1/v2 measurements (got ${v1.protocol}/${v2.protocol})`,
    );
  }

  const durationToleranceSeconds = options.durationToleranceSeconds ?? 0.001;
  const durationDelta = Math.abs(
    v1.media.metadata.durationSeconds - v2.media.metadata.durationSeconds,
  );
  const checks: PlanParityCheck[] = [
    check(
      "decoded-video-frames",
      equalJson(v1.media.frameSha256, v2.media.frameSha256),
      `v1=${v1.media.frameSha256.length} frames, v2=${v2.media.frameSha256.length} frames`,
    ),
    check(
      "canonical-pcm-audio",
      equalJson(v1.media.pcmAudio, v2.media.pcmAudio),
      v1.media.pcmAudio && v2.media.pcmAudio
        ? `v1=${v1.media.pcmAudio.sampleCount} samples, v2=${v2.media.pcmAudio.sampleCount} samples`
        : `v1=${v1.media.pcmAudio ? "present" : "none"}, v2=${v2.media.pcmAudio ? "present" : "none"}`,
    ),
    check(
      "ffprobe-stream-metadata",
      equalJson(comparableMetadata(v1.media.metadata), comparableMetadata(v2.media.metadata)),
      "normalized video/audio stream metadata",
    ),
    check(
      "ffprobe-duration",
      durationDelta <= durationToleranceSeconds,
      `delta=${durationDelta.toFixed(6)}s, tolerance=${durationToleranceSeconds.toFixed(6)}s`,
    ),
    check(
      "chunk-hashes",
      equalJson(
        v1.chunks.map(({ index, sha256, bytes }) => ({ index, sha256, bytes })),
        v2.chunks.map(({ index, sha256, bytes }) => ({ index, sha256, bytes })),
      ),
      `v1=${v1.chunks.length} chunks/${v1.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0)} bytes, ` +
        `v2=${v2.chunks.length} chunks/${v2.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0)} bytes`,
    ),
    check(
      "encoded-output",
      options.requireEncodedOutputEquality !== true ||
        (v1.media.outputSha256 === v2.media.outputSha256 &&
          v1.media.outputBytes === v2.media.outputBytes),
      `v1=${v1.media.outputBytes} bytes/${v1.media.outputSha256}, ` +
        `v2=${v2.media.outputBytes} bytes/${v2.media.outputSha256}` +
        (options.requireEncodedOutputEquality === true ? " (strict)" : " (reported)"),
    ),
    check(
      "transfer-bytes",
      options.maxV2TransferBytes === undefined ||
        v2.transferBytes.total <= options.maxV2TransferBytes,
      `v1=${v1.transferBytes.total} bytes, v2=${v2.transferBytes.total} bytes` +
        (options.maxV2TransferBytes === undefined
          ? " (reported)"
          : `, v2 limit=${options.maxV2TransferBytes}`),
    ),
    check(
      "peak-materialized-working-set",
      options.maxV2PeakMaterializedBytes === undefined ||
        v2.peakMaterializedBytes <= options.maxV2PeakMaterializedBytes,
      `v1=${v1.peakMaterializedBytes} bytes, v2=${v2.peakMaterializedBytes} bytes` +
        (options.maxV2PeakMaterializedBytes === undefined
          ? " (reported)"
          : `, v2 limit=${options.maxV2PeakMaterializedBytes}`),
    ),
  ];

  return {
    passed: checks.every((entry) => entry.passed),
    checks,
    v1,
    v2,
  };
}
