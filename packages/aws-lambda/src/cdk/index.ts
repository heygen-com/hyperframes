/**
 * CDK subpath export — `@hyperframes/aws-lambda/cdk`.
 *
 * Pulled into its own subpath so SDK-only consumers don't import
 * `aws-cdk-lib`. The construct itself depends on `aws-cdk-lib` and
 * `constructs` as peer dependencies; adopters using CDK already have
 * both installed.
 */

export {
  HyperframesRenderStack,
  type HyperframesRenderStackProps,
} from "./HyperframesRenderStack.js";
