/**
 * SDK subpath export — `@hyperframes/gcp-cloud-run/sdk`.
 *
 * Pulled into its own subpath so consumers that only drive renders (CLI, CI
 * scripts, adopter tooling) don't pay the cost of importing `./server.js`,
 * which transitively pulls `puppeteer-core` into the module graph. The SDK
 * files here are GCS + Workflows clients only — safe to load in any Node
 * environment.
 */

export { deploySite, type DeploySiteOptions, type SiteHandle } from "./deploySite.js";
export {
  type ExecutionsClientLike,
  renderToCloudRun,
  type RenderHandle,
  type RenderToCloudRunOptions,
} from "./renderToCloudRun.js";
export {
  type ExecutionRecord,
  type ExecutionsGetClientLike,
  getRenderProgress,
  type GetRenderProgressOptions,
  type RenderError,
  type RenderProgress,
  type RenderStatus,
} from "./getRenderProgress.js";
export {
  type BilledCloudRunInvocation,
  computeRenderCost,
  type RenderCost,
} from "./costAccounting.js";
export {
  InvalidConfigError,
  MAX_WORKFLOWS_INPUT_BYTES,
  validateDistributedRenderConfig,
  validateVariablesPayload,
  validateWorkflowsInputSize,
} from "./validateConfig.js";
export type { SerializableDistributedRenderConfig } from "../events.js";
export type { DistributedFormat } from "../formatExtension.js";
