/**
 * Lambda event + result types for the HyperFrames distributed render handler.
 *
 * The Step Functions state machine in `examples/aws-lambda/template.yaml`
 * dispatches on the `Action` field. Each action maps 1:1 onto one of the
 * three OSS distributed primitives:
 *
 *   "plan"        → `planV2WithPublisher(...)`                (Activity A)
 *   "renderChunk" → `renderChunk(planDir, chunkIndex, output)` (Activity B)
 *   "assemble"    → `assemble(planDir, chunkPaths, audio, out)` (Activity C)
 *
 * All file I/O is mediated by S3 — the handler downloads inputs into
 * `/tmp` (Lambda's only writable filesystem path), invokes the primitive,
 * uploads outputs back to S3, and returns a small JSON payload that fits
 * inside Step Functions' history budget (under 200 bytes for chunk
 * results per §2.4).
 */

import type {
  DistributedFormat,
  SerializableDistributedRenderConfig,
} from "@hyperframes/producer/distributed";

export type { SerializableDistributedRenderConfig } from "@hyperframes/producer/distributed";

/** Discriminator for the three roles the one Lambda image fulfills. */
export type LambdaAction = "plan" | "audio" | "renderChunk" | "assemble";
export interface WarmEvent {
  Action: "warm";
}
/** Assemble hands a helper part of the final mp4's multipart upload: each part's S3 ranges, in order. */
export interface StitchPartsEvent {
  Action: "stitchParts";
  Bucket: string;
  Key: string;
  UploadId: string;
  Parts: { partNumber: number; ranges: { uri: string; start: number; end: number }[] }[];
}
/**
 * Top-level shape of any event the handler may receive.
 *
 * Step Functions can also invoke with a wrapped payload (e.g. when a Map
 * state's `ItemSelector` passes through `$$.Map.Item.Value`), so the
 * handler unwraps both `event.Payload` and `event.Input` before
 * dispatching.
 */
export type LambdaEvent =
  | PlanEvent
  | AudioEvent
  | RenderChunkEvent
  | AssembleEvent
  | WarmEvent
  | StitchPartsEvent
  | { Payload: LambdaEvent }
  | { Input: LambdaEvent };

/** Activity A: produce a planDir, upload to S3. */
export interface PlanEvent {
  Action: "plan";
  /** S3 URI pointing at a `tar -czf`-archived project directory (`s3://bucket/key.tar.gz`). */
  ProjectS3Uri: string;
  /** S3 URI prefix where the planDir tar should be uploaded (`s3://bucket/{prefix}/`). */
  PlanOutputS3Prefix: string;
  /** `DistributedRenderConfig` minus runtime-only fields (logger, abortSignal). */
  Config: SerializableDistributedRenderConfig;
  /** Optional for direct handler callers; the SDK and orchestrator send it explicitly. */
  PlanProtocol?: "v2";
}

/** Compatibility alias for the only supported plan event. */
export type PlanV2Event = PlanEvent;

/** Makes a v2 plan's audio beside its chunks, from the same project and config as the plan. */
export interface AudioEvent extends Omit<PlanEvent, "Action" | "PlanProtocol"> {
  Action: "audio";
}

/** Activity B: fetch planDir, render one chunk, upload result. */
export interface RenderChunkEvent {
  Action: "renderChunk";
  /**
   * `PlanResult.planHash` from the Plan invocation. The handler verifies it
   * against the content-addressed manifest before invoking the producer.
   * Divergence throws a typed `PLAN_HASH_MISMATCH` so the state machine routes
   * it as non-retryable.
   */
  PlanHash: string;
  /** 0-based chunk index this invocation should render. */
  ChunkIndex: number;
  /** S3 URI prefix where the chunk output should be uploaded (`s3://bucket/{prefix}/`). */
  ChunkOutputS3Prefix: string;
  /** Output container format from the plan's encoder.json; drives file vs frame-dir handling. */
  Format: DistributedFormat;
  PlanProtocol?: "v2";
  PlanV2ManifestS3Uri: string;
  PlanV2ArtifactS3Prefix: string;
}

/** Compatibility alias for the only supported chunk event. */
export type RenderChunkV2Event = RenderChunkEvent;

/** Activity C: fetch planDir + all chunks + audio, assemble, upload final. */
export interface AssembleEvent {
  Action: "assemble";
  /** S3 URIs of every chunk, ordered by chunk index. Length must equal `chunkCount`. */
  ChunkS3Uris: string[];
  /** S3 URI of the planDir's audio artifact if the composition has audio; `null` otherwise. */
  AudioS3Uri: string | null;
  /** Final output S3 URI (`s3://bucket/key.mp4`). */
  OutputS3Uri: string;
  /** Output container format; drives file vs frame-dir handling. */
  Format: DistributedFormat;
  /**
   * Optional exact-CFR re-encode at assemble time. When `true`, the final
   * assembled video is re-encoded with `-fps_mode cfr -r <fps>` so the
   * stream's `avg_frame_rate` matches the container's `r_frame_rate`
   * exactly (and the file's duration is exact, not PTS-derived). Trade-off
   * is ~2-5x the assemble wall-clock. mp4 only — webm / mov stream-copy
   * paths already produce exact avg_frame_rate. Default `false` /
   * unset preserves current `-c copy` behavior.
   */
  Cfr?: boolean;
  PlanProtocol?: "v2";
  PlanV2ManifestS3Uri: string;
  PlanV2ArtifactS3Prefix: string;
  PlanHash: string;
}

/** Compatibility alias for the only supported assemble event. */
export type AssembleV2Event = AssembleEvent;

// ── Result types — kept small to fit Step Functions history budgets ─────────

/** Result of a `plan` invocation. Carries enough to size the Map(N) state. */
export interface PlanLambdaResult {
  Action: "plan";
  PlanHash: string;
  ChunkCount: number;
  MaxChunkConcurrency: number;
  TotalFrames: number;
  Fps: SerializableDistributedRenderConfig["fps"];
  Width: number;
  Height: number;
  Format: DistributedFormat;
  HasAudio: boolean;
  AudioS3Uri: string | null;
  FfmpegVersion: string;
  ProducerVersion: string;
  DurationMs: number;
  PlanProtocol: "v2";
  PlanV2ManifestS3Uri: string;
  PlanV2ArtifactS3Prefix: string;
  /** The plan left its audio to the audio task, which has a worker kept free for it. */
  SeparateAudio: boolean;
}

/** Compatibility alias for the only supported plan result. */
export type PlanV2LambdaResult = PlanLambdaResult;

export interface AudioLambdaResult {
  Action: "audio";
  HasAudio: boolean;
  /** The track for the assembler to stitch in; `null` without audio or when the plan mixed it. */
  AudioS3Uri: string | null;
  DurationMs: number;
}

/** Result of a `renderChunk` invocation. Sized ≤200 bytes per §2.4. */
export interface RenderChunkLambdaResult {
  Action: "renderChunk";
  ChunkS3Uri: string;
  ChunkIndex: number;
  Sha256: string;
  FramesEncoded: number;
  /** Effective engine mode after browser probing. Emitted by current handlers. */
  CaptureMode?: "beginframe" | "screenshot" | "drawelement";
  DurationMs: number;
}

/** Result of an `assemble` invocation. */
export interface AssembleLambdaResult {
  Action: "assemble";
  OutputS3Uri: string;
  FramesEncoded: number;
  FileSize: number;
  DurationMs: number;
}

export interface WarmLambdaResult {
  Action: "warm";
}

export interface StitchPartsLambdaResult {
  Action: "stitchParts";
  ETags: string[];
}

export type LambdaResult =
  | WarmLambdaResult
  | StitchPartsLambdaResult
  | PlanLambdaResult
  | AudioLambdaResult
  | RenderChunkLambdaResult
  | AssembleLambdaResult;
