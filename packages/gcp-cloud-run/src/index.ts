/**
 * `@hyperframes/gcp-cloud-run` — Google Cloud Run + Workflows adapter for
 * the HyperFrames distributed render pipeline.
 *
 * Two surfaces, one package:
 *
 *  - **Server-side handler.** `dispatch`, `createApp`, the request/result
 *    types, Chrome resolution, and GCS transport. These power the Cloud Run
 *    service built from the package `Dockerfile`.
 *  - **Client-side SDK.** `renderToCloudRun`, `getRenderProgress`,
 *    `deploySite`, `validateDistributedRenderConfig`, and `computeRenderCost`.
 *    Adopters call these from their Node process (CI scripts, CLIs) to drive
 *    a deployed stack without writing GCS / Workflows boilerplate.
 *
 * The Terraform module that provisions the bucket + service + workflow lives
 * under `terraform/` in the published package; see the README. The package
 * is NOT a dependency of `@hyperframes/producer`; consumers install it
 * separately.
 */

export { createApp, dispatch, type HandlerDeps, startServer, unwrapEvent } from "./server.js";
export {
  type AssembleEvent,
  type AssembleV1Event,
  type AssembleV2Event,
  type AssembleResultBody,
  type CloudRunAction,
  type CloudRunEvent,
  type CloudRunPlanProtocol,
  type CloudRunResult,
  type PlanEvent,
  type PlanResultBody,
  type PlanV1Event,
  type PlanV1ResultBody,
  type PlanV2Event,
  type PlanV2ResultBody,
  type RenderChunkEvent,
  type RenderChunkResultBody,
  type RenderChunkV1Event,
  type RenderChunkV2Event,
  type SerializableDistributedRenderConfig,
} from "./events.js";
export { ChromeBinaryUnavailableError, resolveChromeExecutablePath } from "./chromium.js";
export {
  downloadGcsObjectToFile,
  downloadGcsObjectToFileVerified,
  formatGcsUri,
  type GcsLocation,
  parseGcsUri,
  sha256File,
  tarDirectory,
  untarDirectory,
  uploadContentAddressedFileToGcs,
  uploadFileToGcs,
} from "./gcsTransport.js";
export {
  GcsPlanV2ArtifactPublisher,
  type GcsPlanV2ArtifactPublisherOptions,
} from "./gcsPlanV2Publisher.js";

// ── Client-side SDK ─────────────────────────────────────────────────────────
export { deploySite, type DeploySiteOptions, type SiteHandle } from "./sdk/deploySite.js";
export {
  renderToCloudRun,
  type RenderHandle,
  type RenderToCloudRunOptions,
} from "./sdk/renderToCloudRun.js";
export {
  getRenderProgress,
  type GetRenderProgressOptions,
  type RenderError,
  type RenderProgress,
  type RenderStatus,
} from "./sdk/getRenderProgress.js";
export {
  type BilledCloudRunInvocation,
  computeRenderCost,
  type RenderCost,
} from "./sdk/costAccounting.js";
export { InvalidConfigError, validateDistributedRenderConfig } from "./sdk/validateConfig.js";
export { getTerraformModuleDir } from "./terraform.js";
