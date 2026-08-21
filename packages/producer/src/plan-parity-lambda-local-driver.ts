// fallow-ignore-file unused-file
// Loaded by a runtime-only dynamic import so producer declaration emit does
// not eagerly resolve the AWS workspace package.
/**
 * Lambda-local adapter for the generic v1/v2 parity runner.
 *
 * Kept separate from the protocol-neutral harness because it imports
 * `@hyperframes/aws-lambda`; producer's declaration emit runs before the
 * Lambda workspace package is built in some CI stages.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { PlanParityDriver } from "./plan-parity-contract.js";
import { runLambdaLocalRender } from "./regression-harness-lambda-local.js";

export function createLambdaLocalPlanParityDriver(): PlanParityDriver {
  return {
    name: "lambda-local",
    async render(input) {
      if (existsSync(input.outputDir)) {
        rmSync(input.outputDir, { recursive: true, force: true });
      }
      mkdirSync(input.outputDir, { recursive: true });
      return runLambdaLocalRender({
        protocol: input.protocol,
        projectDir: input.projectDir,
        tempRoot: input.outputDir,
        renderedOutputPath: join(input.outputDir, "output.mp4"),
        fps: input.renderConfig.fps,
        width: input.renderConfig.width,
        height: input.renderConfig.height,
        format: input.renderConfig.format,
        chunkSize: input.renderConfig.chunkSize,
        maxParallelChunks: input.renderConfig.maxParallelChunks,
        planDirSizeLimitBytes: input.planSizeCapBytes,
      });
    },
  };
}
