/**
 * `@hyperframes/aws-lambda` — Lambda adapter for the HyperFrames
 * distributed render pipeline.
 *
 * The package exports the Lambda handler entry point plus the event /
 * result types Step Functions consumers and CDK constructs need to
 * type-check their state machine definitions.
 *
 * The handler is bundled with `scripts/build-zip.ts` into `dist/handler.zip`
 * — that artifact is what `examples/aws-lambda/template.yaml` and any
 * future CDK construct point at via `CodeUri`. The package is NOT a
 * dependency of `@hyperframes/producer`; consumers install it separately.
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
