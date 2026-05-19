/**
 * Public-facing types for `./regression-harness-lambda-local.ts`.
 *
 * Kept in its own file because the implementation imports
 * `@hyperframes/aws-lambda`, which can't be resolved by producer's
 * tsc emit pass until aws-lambda's own dist/ is built. Splitting the
 * types out lets producer's regression harness reference the lambda
 * adapter's shape without pulling the aws-lambda graph into producer's
 * type-check pass.
 */

import type { DistributedFormat } from "./services/distributed/shared.js";

/** Inputs for {@link runLambdaLocalRender}. Same contract as `runDistributedSimulatedRender`. */
export interface RunLambdaLocalInput {
  projectDir: string;
  tempRoot: string;
  renderedOutputPath: string;
  fps: 24 | 30 | 60;
  /**
   * Width/height from the fixture's renderConfig. Forwarded directly to
   * the Lambda event so this mode catches drift if the handler ever
   * starts honouring `Config.width/height` for canvas sizing rather
   * than reading the composition's `data-width`/`data-height`. The
   * `distributed-simulated` mode hardcodes 1920×1080 because it
   * bypasses the event-serialization boundary; lambda-local goes
   * through it, which is the whole point.
   */
  width: number;
  height: number;
  format: DistributedFormat;
  codec?: "h264" | "h265";
  chunkSize?: number;
  maxParallelChunks?: number;
  variables?: Record<string, unknown>;
}

/** Public signature of the dynamically-loaded `runLambdaLocalRender`. */
export type RunLambdaLocalRender = (input: RunLambdaLocalInput) => Promise<void>;
