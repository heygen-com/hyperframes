/**
 * `@hyperframes/producer/distributed` — the distributed render primitives.
 *
 * The three activities (`plan` → `renderChunk` × N → `assemble`) are pure
 * functions over local file paths; networking + orchestration live in
 * adapters.
 *
 * Adopters (AWS Lambda, Cloud Run Jobs, Temporal, K8s Jobs, plain SSH):
 *
 * ```ts
 * import {
 *   plan,
 *   renderChunk,
 *   assemble,
 * } from "@hyperframes/producer/distributed";
 *
 * // Controller-side: produce a self-contained planDir + content-addressed planHash.
 * const planResult = await plan(projectDir, config, planDir);
 *
 * // Worker-side: render one chunk. Byte-identical retries on the same
 * // (planDir, chunkIndex) — Temporal / Step Functions retry policies are
 * // safe to point at this.
 * const chunk = await renderChunk(planDir, chunkIndex, outputChunkPath);
 *
 * // Controller-side: stitch chunks into the final deliverable.
 * await assemble(planDir, chunkPaths, audioPath, outputPath);
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

// ── RenderChunk (Activity B) ────────────────────────────────────────────────
export {
  applyRuntimeEnvSnapshot,
  readWebGlVendorInfoFromCanvas,
  renderChunk,
  // Types
  type ChunkResult,
  // Error codes + classes
  FFMPEG_VERSION_MISMATCH,
  PLAN_HASH_MISMATCH,
  RenderChunkValidationError,
} from "./services/distributed/renderChunk.js";

// ── Assemble (Activity C) ───────────────────────────────────────────────────
export { assemble, type AssembleResult } from "./services/distributed/assemble.js";

// ── Format union ────────────────────────────────────────────────────────────
// Canonical output-format type. The aws-lambda package re-exports it so
// CLI / adopter SDKs can derive runtime allowlists from one source.
export type { DistributedFormat } from "./services/distributed/shared.js";

// ── Plan-time shared types from `freezePlan` ───────────────────────────────
// Re-exported so adopters that deserialize a planDir's `meta/encoder.json`
// or `meta/chunks.json` see the same shapes the producer wrote them as.
export type {
  ChunkSliceJson,
  CompositionMetadataJson,
  LockedRenderConfig,
} from "./services/render/stages/freezePlan.js";
