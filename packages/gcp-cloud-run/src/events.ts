/**
 * Request + result types for the HyperFrames distributed render handler
 * running on Cloud Run.
 *
 * The Cloud Workflows definition in `packages/gcp-cloud-run/terraform/workflow.yaml`
 * dispatches on the `Action` field of the JSON request body. Each action
 * maps 1:1 onto one of the three OSS distributed primitives:
 *
 *   "plan"        → `planV2WithPublisher(...)`                (Activity A)
 *   "renderChunk" → `renderChunk(planDir, chunkIndex, output)` (Activity B)
 *   "assemble"    → `assemble(planDir, chunkPaths, audio, out)` (Activity C)
 *
 * All file I/O is mediated by GCS — the handler downloads inputs into a
 * per-request workdir under the container's writable `/tmp`, invokes the
 * primitive, uploads outputs back to GCS, and returns a small JSON payload
 * that fits inside a Cloud Workflows step variable (Workflows caps a single
 * step's memory; chunk results stay well under 1 KB so the orchestration
 * can hold one per Map iteration).
 *
 * These shapes are intentionally identical to `@hyperframes/aws-lambda`'s
 * `events.ts` apart from the URI scheme (`gs://` vs `s3://`): the wire
 * contract is the adapter's, the primitives underneath are shared.
 */

import type {
  DistributedFormat,
  SerializableDistributedRenderConfig,
} from "@hyperframes/producer/distributed";

export type { SerializableDistributedRenderConfig } from "@hyperframes/producer/distributed";

/** Discriminator for the three roles the one Cloud Run image fulfills. */
export type CloudRunAction = "plan" | "renderChunk" | "assemble";
/**
 * Top-level shape of any request body the handler may receive.
 *
 * Cloud Workflows passes the step's `body` through verbatim, but a caller
 * driving the service directly (or a Workflows definition that wraps the
 * payload) may nest it under `Payload` / `Input`; the handler unwraps both
 * before dispatching, matching the Lambda adapter's envelope tolerance.
 */
export type CloudRunEvent =
  | PlanEvent
  | RenderChunkEvent
  | AssembleEvent
  | { Payload: CloudRunEvent }
  | { Input: CloudRunEvent };

/** Activity A: produce a planDir, upload to GCS. */
export interface PlanEvent {
  Action: "plan";
  /** GCS URI pointing at a `tar -czf`-archived project directory (`gs://bucket/key.tar.gz`). */
  ProjectGcsUri: string;
  /** GCS URI prefix where the planDir tar should be uploaded (`gs://bucket/{prefix}/`). */
  PlanOutputGcsPrefix: string;
  /** `DistributedRenderConfig` minus runtime-only fields (logger, abortSignal). */
  Config: SerializableDistributedRenderConfig;
  /** Optional for direct handler callers; the SDK and orchestrator send it explicitly. */
  PlanProtocol?: "v2";
}

/** Compatibility alias for the only supported plan event. */
export type PlanV2Event = PlanEvent;

/** Activity B: fetch planDir, render one chunk, upload result. */
export interface RenderChunkEvent {
  Action: "renderChunk";
  /**
   * `PlanResult.planHash` from the Plan invocation. The handler verifies
   * this against the untarred planDir's `plan.json` before invoking the
   * producer, throwing a typed `PLAN_HASH_MISMATCH` on divergence so the
   * workflow routes it as non-retryable. Defense-in-depth — the producer
   * also re-checks internally.
   */
  PlanHash: string;
  /** 0-based chunk index this invocation should render. */
  ChunkIndex: number;
  /** GCS URI prefix where the chunk output should be uploaded (`gs://bucket/{prefix}/`). */
  ChunkOutputGcsPrefix: string;
  /** Output container format from the plan's encoder.json; drives file vs frame-dir handling. */
  Format: DistributedFormat;
  PlanProtocol?: "v2";
  PlanV2ManifestGcsUri: string;
  PlanV2ArtifactGcsPrefix: string;
}

/** Compatibility alias for the only supported chunk event. */
export type RenderChunkV2Event = RenderChunkEvent;

/** Activity C: fetch planDir + all chunks + audio, assemble, upload final. */
export interface AssembleEvent {
  Action: "assemble";
  /** GCS URIs of every chunk, ordered by chunk index. Length must equal `chunkCount`. */
  ChunkGcsUris: string[];
  /** Final output GCS URI (`gs://bucket/key.mp4`). */
  OutputGcsUri: string;
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
  PlanV2ManifestGcsUri: string;
  PlanV2ArtifactGcsPrefix: string;
  PlanHash: string;
  /** V2 audio is a manifest artifact materialized only for the assembler. */
  AudioGcsUri: null;
}

/** Compatibility alias for the only supported assemble event. */
export type AssembleV2Event = AssembleEvent;

// ── Result types — kept small to fit Cloud Workflows step budgets ────────────

/** Result of a `plan` invocation. Carries enough to size the Map(N) state. */
export interface PlanResultBody {
  Action: "plan";
  PlanHash: string;
  ChunkCount: number;
  TotalFrames: number;
  Fps: SerializableDistributedRenderConfig["fps"];
  Width: number;
  Height: number;
  Format: DistributedFormat;
  HasAudio: boolean;
  FfmpegVersion: string;
  ProducerVersion: string;
  DurationMs: number;
  PlanProtocol: "v2";
  PlanV2ManifestGcsUri: string;
  PlanV2ArtifactGcsPrefix: string;
  AudioGcsUri: null;
}

/** Compatibility alias for the only supported plan result. */
export type PlanV2ResultBody = PlanResultBody;

/** Result of a `renderChunk` invocation. Sized ≤200 bytes. */
export interface RenderChunkResultBody {
  Action: "renderChunk";
  ChunkGcsUri: string;
  ChunkIndex: number;
  Sha256: string;
  FramesEncoded: number;
  /** Effective engine mode after browser probing. Emitted by current handlers. */
  CaptureMode?: "beginframe" | "screenshot" | "drawelement";
  DurationMs: number;
}

/** Result of an `assemble` invocation. */
export interface AssembleResultBody {
  Action: "assemble";
  OutputGcsUri: string;
  FramesEncoded: number;
  FileSize: number;
  DurationMs: number;
}

export type CloudRunResult = PlanResultBody | RenderChunkResultBody | AssembleResultBody;
