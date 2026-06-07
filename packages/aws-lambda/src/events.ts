/**
 * Lambda event + result types for the HyperFrames distributed render handler.
 *
 * The Step Functions state machine in `examples/aws-lambda/template.yaml`
 * dispatches on the `Action` field. Each action maps 1:1 onto one of the
 * three OSS distributed primitives:
 *
 *   "plan"        → `plan(projectDir, config, planDir)`        (Activity A)
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
export type LambdaAction = "plan" | "renderChunk" | "assemble";

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
  | RenderChunkEvent
  | AssembleEvent
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
}

/** Activity B: fetch planDir, render one chunk, upload result. */
export interface RenderChunkEvent {
  Action: "renderChunk";
  /** S3 URI of the plan tar produced by a PlanEvent invocation. */
  PlanS3Uri: string;
  /**
   * `PlanResult.planHash` from the Plan invocation. The handler verifies
   * this against the untarred planDir's `plan.json` before invoking the
   * producer, throwing a typed `PLAN_HASH_MISMATCH` on divergence so the
   * state machine routes it as non-retryable. Defense-in-depth — the
   * producer also re-checks internally.
   */
  PlanHash: string;
  /** 0-based chunk index this invocation should render. */
  ChunkIndex: number;
  /** S3 URI prefix where the chunk output should be uploaded (`s3://bucket/{prefix}/`). */
  ChunkOutputS3Prefix: string;
  /** Output container format from the plan's encoder.json; drives file vs frame-dir handling. */
  Format: DistributedFormat;
}

/** Activity C: fetch planDir + all chunks + audio, assemble, upload final. */
export interface AssembleEvent {
  Action: "assemble";
  /** S3 URI of the plan tar produced by a PlanEvent invocation. */
  PlanS3Uri: string;
  /** S3 URIs of every chunk, ordered by chunk index. Length must equal `chunkCount`. */
  ChunkS3Uris: string[];
  /** S3 URI of the planDir's `audio.aac` if the composition has audio; `null` otherwise. */
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
}

// ── Result types — kept small to fit Step Functions history budgets ─────────

/** Result of a `plan` invocation. Carries enough to size the Map(N) state. */
export interface PlanLambdaResult {
  Action: "plan";
  PlanS3Uri: string;
  PlanHash: string;
  ChunkCount: number;
  TotalFrames: number;
  Fps: 24 | 30 | 60;
  Width: number;
  Height: number;
  Format: DistributedFormat;
  HasAudio: boolean;
  AudioS3Uri: string | null;
  FfmpegVersion: string;
  ProducerVersion: string;
  DurationMs: number;
}

/** Result of a `renderChunk` invocation. Sized ≤200 bytes per §2.4. */
export interface RenderChunkLambdaResult {
  Action: "renderChunk";
  ChunkS3Uri: string;
  ChunkIndex: number;
  Sha256: string;
  FramesEncoded: number;
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

export type LambdaResult = PlanLambdaResult | RenderChunkLambdaResult | AssembleLambdaResult;
