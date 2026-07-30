/**
 * `@hyperframes/producer/distributed` — the distributed render primitives.
 *
 * The distributed activities are pure functions over local file paths;
 * networking + orchestration live in adapters. New integrations should use
 * Plan v2; the v1 functions remain available for compatibility.
 *
 * Adopters (AWS Lambda, Cloud Run Jobs, Temporal, K8s Jobs, plain SSH):
 *
 * ```ts
 * import {
 *   planV2,
 *   renderChunkV2,
 *   assembleV2,
 * } from "@hyperframes/producer/distributed";
 *
 * // Controller-side: publish a content-addressed Plan v2 manifest + CAS.
 * const planResult = await planV2(projectDir, config, planV2Dir);
 *
 * // Worker-side: render one chunk. Byte-identical retries on the same
 * // (planV2Dir, chunkIndex) — Temporal / Step Functions retry policies are
 * // safe to point at this.
 * const chunk = await renderChunkV2(planV2Dir, chunkIndex, outputChunkPath);
 *
 * // Controller-side: stitch chunks into the final deliverable.
 * await assembleV2(planV2Dir, chunkPaths, outputPath);
 * ```
 *
 * No networking, no AWS SDK, no Temporal SDK — those live in adapter
 * packages. This module is library code only.
 */

// ── Plan (Activity A) ───────────────────────────────────────────────────────
export {
  // Functions
  buildChunkSlices,
  measurePlanDirBytes,
  plan,
  rejectUnsupportedDistributedFormat,
  resolveChunkPlan,
  // Types
  type DistributedRenderConfig,
  type PlanResult,
  // Constants
  DEFAULT_CHUNK_SIZE,
  DEFAULT_MAX_PARALLEL_CHUNKS,
  MIN_CHUNK_SIZE,
  PLAN_DIR_SIZE_LIMIT_BYTES,
  PLAN_PROJECT_DIR_SKIP_SEGMENTS,
  // Error codes + classes
  FORMAT_NOT_SUPPORTED_IN_DISTRIBUTED,
  FormatNotSupportedInDistributedError,
  PLAN_TOO_LARGE,
  PlanTooLargeError,
} from "./services/distributed/plan.js";

// ── Plan v2 content-addressed transport ────────────────────────────────────
export {
  createPlanV2FromExecutionPlan,
  createPlanV2FromV1,
  getPlanV2ExecutionPlanHash,
  listPlanV2ArtifactsForTarget,
  materializePlanV2Target,
  planV2,
  planV2WithPublisher,
  publishPlanV2FromExecutionPlan,
  publishPlanV2FromV1,
  readPlanV2Manifest,
  validatePlanV2MaterializedTarget,
  PLAN_V2_INTEGRITY_UNRECOVERABLE,
  PLAN_V2_MATERIALIZATION_MARKER,
  PlanV2IntegrityError,
  type PlanV2Artifact,
  type PlanV2Limitations,
  type PlanV2Manifest,
  type PlanV2MaterializationResult,
  type PlanV2MaterializationTarget,
  type PlanV2Result,
  type PlanV2WithPublisherOptions,
} from "./services/distributed/planV2.js";
export {
  LocalPlanV2ArtifactPublisher,
  type LocalPlanV2ArtifactPublisherOptions,
  type PlanV2ArtifactPublisher,
  type PlanV2PublishBlob,
} from "./services/distributed/planV2Publisher.js";
export { assembleV2, renderChunkV2 } from "./services/distributed/planV2Execution.js";

// ── RenderChunk (Activity B) ────────────────────────────────────────────────
export {
  applyRuntimeEnvSnapshot,
  readWebGlVendorInfoFromCanvas,
  renderChunk,
  // Types
  type ChunkRenderer,
  type ChunkResult,
  type EffectiveChunkResult,
  // Error codes + classes
  FFMPEG_VERSION_MISMATCH,
  INVALID_VIDEO_METADATA,
  PLAN_HASH_MISMATCH,
  RenderChunkValidationError,
} from "./services/distributed/renderChunk.js";

// ── Assemble (Activity C) ───────────────────────────────────────────────────
export { assemble, type AssembleResult } from "./services/distributed/assemble.js";

// ── Cloud-agnostic adapter helpers ──────────────────────────────────────────
// Shared by the distributed-render adapters (aws-lambda, gcp-cloud-run, …) so
// the config-shape validator lives in one place; each adapter layers only its
// own wire-format size cap on top.
export {
  InvalidConfigError,
  type SerializableDistributedRenderConfig,
  validateDistributedRenderConfig,
  validateVariablesPayload,
} from "./services/distributed/renderConfigValidation.js";
export { hashProjectDir } from "./services/distributed/projectHash.js";

// ── Plan protocol compatibility ────────────────────────────────────────────
// Workers validate this descriptor before consuming layout-specific
// artifacts. Missing descriptors remain compatible with legacy v1 plans.
export {
  CURRENT_PLAN_PROTOCOL,
  DISTRIBUTED_RENDER_CAPABILITIES,
  getDistributedRenderCapabilities,
  PLAN_ARTIFACT_LAYOUT,
  PLAN_HASH_SCHEMA,
  PLAN_PROTOCOL_V1,
  PLAN_PROTOCOL_V2,
  PLAN_PROTOCOL_UNSUPPORTED,
  PLAN_SCHEMA_VERSION,
  PLAN_V2_ARTIFACT_LAYOUT,
  PLAN_V2_HASH_SCHEMA,
  PLAN_V2_SCHEMA_VERSION,
  PlanProtocolUnsupportedError,
  readPlanProtocol,
  readPlanProtocolV1,
  type DistributedRenderCapabilities,
  type PlanProtocolConsumerCapabilities,
  type PlanProtocolDescriptor,
  type PlanProtocolV1Descriptor,
  type PlanProtocolV2Descriptor,
  type SupportedPlanProtocolDescriptor,
} from "./services/distributed/planProtocol.js";

// ── Format union ────────────────────────────────────────────────────────────
// Canonical output-format type. The aws-lambda package re-exports it so
// CLI / adopter SDKs can derive runtime allowlists from one source.
export { PlanVideosMetadataError, type DistributedFormat } from "./services/distributed/shared.js";

// ── Plan-time shared types from `freezePlan` ───────────────────────────────
// Re-exported so adopters that deserialize a planDir's `meta/encoder.json`
// or `meta/chunks.json` see the same shapes the producer wrote them as.
export type {
  ChunkSliceJson,
  CompositionMetadataJson,
  LockedRenderConfig,
} from "./services/render/stages/freezePlan.js";

// ── Plan-time validation errors ────────────────────────────────────────────
// Export typed deterministic validation codes so orchestration adapters can
// mark authoring/configuration failures as terminal while still retrying real
// infrastructure faults.
export {
  DISTRIBUTED_DURATION_OUT_OF_RANGE,
  MAX_DISTRIBUTED_DURATION_SECONDS,
  PlanValidationError,
} from "./services/render/planValidation.js";
