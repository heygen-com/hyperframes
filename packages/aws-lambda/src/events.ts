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
/** Transport protocol selected for one complete distributed render. */
export type LambdaPlanProtocol = "v1" | "v2";

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
interface PlanEventBase {
  Action: "plan";
  /** S3 URI pointing at a `tar -czf`-archived project directory (`s3://bucket/key.tar.gz`). */
  ProjectS3Uri: string;
  /** S3 URI prefix where the planDir tar should be uploaded (`s3://bucket/{prefix}/`). */
  PlanOutputS3Prefix: string;
  /** `DistributedRenderConfig` minus runtime-only fields (logger, abortSignal). */
  Config: SerializableDistributedRenderConfig;
}

/** Legacy/default plan transport. Absence is deliberately interpreted as v1. */
export interface PlanV1Event extends PlanEventBase {
  PlanProtocol?: "v1";
}

/** Explicit opt-in to the content-addressed v2 plan transport. */
export interface PlanV2Event extends PlanEventBase {
  PlanProtocol: "v2";
}

export type PlanEvent = PlanV1Event | PlanV2Event;

/** Activity B: fetch planDir, render one chunk, upload result. */
interface RenderChunkEventBase {
  Action: "renderChunk";
  /**
   * `PlanResult.planHash` from the Plan invocation. For v1, the handler
   * verifies it against the untarred planDir's `plan.json`; for v2, it
   * verifies it against the content-addressed manifest before invoking the
   * producer. Divergence throws a typed `PLAN_HASH_MISMATCH` so the state
   * machine routes it as non-retryable.
   */
  PlanHash: string;
  /** 0-based chunk index this invocation should render. */
  ChunkIndex: number;
  /** S3 URI prefix where the chunk output should be uploaded (`s3://bucket/{prefix}/`). */
  ChunkOutputS3Prefix: string;
  /** Output container format from the plan's encoder.json; drives file vs frame-dir handling. */
  Format: DistributedFormat;
}

/** Legacy/default chunk event. */
export interface RenderChunkV1Event extends RenderChunkEventBase {
  PlanProtocol?: "v1";
  /** S3 URI of the v1 plan tar produced by a PlanEvent invocation. */
  PlanS3Uri: string;
}

/**
 * V2 chunk event. It intentionally cannot carry `PlanS3Uri`: the manifest
 * describes the exact content-addressed artifacts needed by this chunk.
 */
export interface RenderChunkV2Event extends RenderChunkEventBase {
  PlanProtocol: "v2";
  PlanV2ManifestS3Uri: string;
  PlanV2ArtifactS3Prefix: string;
}

export type RenderChunkEvent = RenderChunkV1Event | RenderChunkV2Event;

/** Activity C: fetch planDir + all chunks + audio, assemble, upload final. */
interface AssembleEventBase {
  Action: "assemble";
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

/** Legacy/default assemble event. */
export interface AssembleV1Event extends AssembleEventBase {
  PlanProtocol?: "v1";
  /** S3 URI of the v1 plan tar produced by a PlanEvent invocation. */
  PlanS3Uri: string;
}

/** V2 assemble event, scoped to manifest-declared assembler artifacts. */
export interface AssembleV2Event extends AssembleEventBase {
  PlanProtocol: "v2";
  PlanV2ManifestS3Uri: string;
  PlanV2ArtifactS3Prefix: string;
  PlanHash: string;
}

export type AssembleEvent = AssembleV1Event | AssembleV2Event;

// ── Result types — kept small to fit Step Functions history budgets ─────────

/** Result of a `plan` invocation. Carries enough to size the Map(N) state. */
interface PlanLambdaResultBase {
  Action: "plan";
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

/** Existing v1 result. Kept unchanged for wire compatibility. */
export interface PlanV1LambdaResult extends PlanLambdaResultBase {
  PlanS3Uri: string;
}

/** V2 result. The two v2 locators are never aliases for `PlanS3Uri`. */
export interface PlanV2LambdaResult extends PlanLambdaResultBase {
  PlanProtocol: "v2";
  PlanV2ManifestS3Uri: string;
  PlanV2ArtifactS3Prefix: string;
}

export type PlanLambdaResult = PlanV1LambdaResult | PlanV2LambdaResult;

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
