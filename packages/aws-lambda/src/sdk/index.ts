/**
 * SDK subpath export — `@hyperframes/aws-lambda/sdk`.
 *
 * Pulled into its own subpath so consumers that only drive Lambda renders
 * (CLI, CI scripts, adopter tooling) don't pay the cost of importing
 * `./handler.js`, which transitively pulls `@sparticuz/chromium` +
 * `puppeteer-core` into the module graph. The SDK files here are
 * AWS-SDK only — safe to load in any Node environment.
 */

export {
  deploySite,
  type DeploySiteOptions,
  type SiteHandle,
  siteHandleFromId,
} from "./deploySite.js";
export {
  assertStackReadsSites,
  renderToLambda,
  type RenderHandle,
  type RenderToLambdaOptions,
} from "./renderToLambda.js";
export {
  getRenderProgress,
  type GetRenderProgressOptions,
  type RenderError,
  type RenderProgress,
  type RenderStatus,
} from "./getRenderProgress.js";
export {
  type BilledLambdaInvocation,
  computeRenderCost,
  type RenderCost,
} from "./costAccounting.js";
export {
  InvalidConfigError,
  MAX_STEP_FUNCTIONS_INPUT_BYTES,
  validateDistributedRenderConfig,
  validateStepFunctionsInputSize,
  validateVariablesPayload,
} from "./validateConfig.js";
export {
  type PrebuiltHandler,
  prebuiltHandler,
  prebuiltVideoImage,
  type ReleaseAssetManifest,
} from "./prebuiltHandler.js";
export {
  ensureEcrRepository,
  type EnsureEcrRepositoryOptions,
  type PushedImage,
  pushImageToEcr,
  type PushImageToEcrOptions,
} from "./pushImageToEcr.js";
export type { SerializableDistributedRenderConfig } from "../events.js";
export type { DistributedFormat } from "../formatExtension.js";
