/**
 * `@hyperframes/aws-lambda` — Lambda adapter for the HyperFrames
 * distributed render pipeline.
 *
 * Two surfaces, one package:
 *
 *  - **Server-side handler.** `handler`, the Step Functions event/result
 *    types, Chrome resolution, and S3 transport. These power the Lambda
 *    function bundled into `dist/handler.zip`.
 *  - **Client-side SDK.** `renderToLambda`, `getRenderProgress`,
 *    `deploySite`, `validateDistributedRenderConfig`, and `computeRenderCost`.
 *    Adopters call these from their Node process (CI scripts, CLIs, CDK
 *    pipelines) to drive a deployed stack without writing AWS-SDK
 *    boilerplate.
 *
 * The CDK L2 construct lives at the `./cdk` subpath export so SDK-only
 * consumers don't pull `aws-cdk-lib` into their runtime graph:
 *
 *     import { HyperframesRenderStack } from "@hyperframes/aws-lambda/cdk";
 *
 * The package is NOT a dependency of `@hyperframes/producer`; consumers
 * install it separately.
 */

export { handler, type HandlerDeps, unwrapEvent } from "./handler.js";
export {
  type AssembleEvent,
  type AssembleLambdaResult,
  type LambdaAction,
  type LambdaEvent,
  type LambdaResult,
  type PlanEvent,
  type PlanLambdaResult,
  type RenderChunkEvent,
  type RenderChunkLambdaResult,
  type SerializableDistributedRenderConfig,
} from "./events.js";
// `_setSparticuzChromiumForTests` is intentionally NOT re-exported from
// the package barrel — it's a test-only DI seam. Test files import it
// directly from `./chromium.js`.
export {
  type ChromeSource,
  resolveChromeArgs,
  resolveChromeExecutablePath,
  resolveChromeSource,
} from "./chromium.js";
export {
  downloadS3ObjectToFile,
  formatS3Uri,
  parseS3Uri,
  type S3Location,
  tarDirectory,
  untarDirectory,
  uploadFileToS3,
} from "./s3Transport.js";

// ── Client-side SDK ─────────────────────────────────────────────────────────
export { deploySite, type DeploySiteOptions, type SiteHandle } from "./sdk/deploySite.js";
export {
  renderToLambda,
  type RenderHandle,
  type RenderToLambdaOptions,
} from "./sdk/renderToLambda.js";
export {
  getRenderProgress,
  type GetRenderProgressOptions,
  type RenderError,
  type RenderProgress,
  type RenderStatus,
} from "./sdk/getRenderProgress.js";
export {
  type BilledLambdaInvocation,
  computeRenderCost,
  type RenderCost,
} from "./sdk/costAccounting.js";
export { InvalidConfigError, validateDistributedRenderConfig } from "./sdk/validateConfig.js";
// The CDK construct is exported separately via the `./cdk` subpath so
// SDK-only consumers don't pay the `aws-cdk-lib` import cost.
