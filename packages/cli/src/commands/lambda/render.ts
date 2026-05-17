/**
 * `hyperframes lambda render <projectDir>` — start a distributed render
 * against the deployed stack. Wraps {@link renderToLambda}. Does NOT
 * poll — use `hyperframes lambda progress` for that.
 */

import { resolve as resolvePath } from "node:path";
import type { SerializableDistributedRenderConfig } from "@hyperframes/aws-lambda/sdk";
import { c } from "../../ui/colors.js";
import { requireStack, stateFilePath } from "./state.js";

// Dynamic-import the SDK so tsup keeps it out of the static-import head of
// the CLI bundle. See sites.ts loadSDK() for the full rationale.
async function loadSDK(): Promise<typeof import("@hyperframes/aws-lambda/sdk")> {
  return import("@hyperframes/aws-lambda/sdk");
}

export interface RenderArgs {
  projectDir: string;
  stackName: string;
  siteId?: string;
  /** Composition config — fps/width/height/format required, rest optional. */
  fps: 24 | 30 | 60;
  width: number;
  height: number;
  format: "mp4" | "mov" | "png-sequence";
  codec?: "h264" | "h265";
  quality?: "draft" | "standard" | "high";
  chunkSize?: number;
  maxParallelChunks?: number;
  executionName?: string;
  outputKey?: string;
  /** Print machine-readable JSON instead of the human-friendly summary. */
  json: boolean;
  /** Block until the render finishes. Polls `progress` until SUCCEEDED/FAILED. */
  wait: boolean;
  /** Poll cadence in ms when `--wait` is set. */
  waitIntervalMs: number;
}

export async function runRender(args: RenderArgs): Promise<void> {
  const stack = requireStack(args.stackName);
  const projectDir = resolvePath(args.projectDir);

  const config: SerializableDistributedRenderConfig = {
    fps: args.fps,
    width: args.width,
    height: args.height,
    format: args.format,
    codec: args.codec,
    quality: args.quality,
    chunkSize: args.chunkSize,
    maxParallelChunks: args.maxParallelChunks,
    runtimeCap: "lambda",
  };

  // When the caller passes only --site-id, synthesise the minimum-shape
  // SiteHandle pointing at the deterministic content-addressed key. The
  // `bytes` / `uploadedAt` fields are intentionally placeholders — the
  // SDK reads only `siteId` + `projectS3Uri` when `uploaded: false`.
  const siteHandle = args.siteId
    ? {
        siteId: args.siteId,
        bucketName: stack.bucketName,
        projectS3Uri: `s3://${stack.bucketName}/sites/${args.siteId}/project.tar.gz`,
        bytes: 0,
        uploadedAt: "",
        uploaded: false,
      }
    : undefined;

  const { renderToLambda } = await loadSDK();
  const handle = await renderToLambda({
    projectDir: siteHandle ? undefined : projectDir,
    siteHandle,
    bucketName: stack.bucketName,
    stateMachineArn: stack.stateMachineArn,
    region: stack.region,
    config,
    executionName: args.executionName,
    outputKey: args.outputKey,
  });

  if (args.json) {
    // --wait + --json should emit a single parseable JSON document: the
    // final progress snapshot. Without --wait, emit the handle (the
    // caller will poll progress separately). Previously this printed
    // both, producing two concatenated JSON blobs that `jq -r` would
    // misparse.
    if (args.wait) {
      await waitForCompletion(handle.executionArn, stack, args.waitIntervalMs, args.json);
    } else {
      console.log(JSON.stringify(handle, null, 2));
    }
    return;
  }

  console.log(c.success("Render started."));
  console.log(`  ${c.dim("Render ID:")}     ${handle.renderId}`);
  console.log(`  ${c.dim("Execution ARN:")} ${handle.executionArn}`);
  console.log(`  ${c.dim("Output S3 URI:")} ${handle.outputS3Uri}`);
  console.log(`  ${c.dim("Project S3:")}    ${handle.projectS3Uri}`);
  console.log(`  ${c.dim("Stack state:")}   ${stateFilePath(args.stackName)}`);
  console.log();
  if (args.wait) {
    await waitForCompletion(handle.executionArn, stack, args.waitIntervalMs, args.json);
    return;
  }
  console.log(c.dim(`Poll with: hyperframes lambda progress ${handle.renderId}`));
}

async function waitForCompletion(
  executionArn: string,
  stack: { region: string; functionName: string; lambdaMemoryMb: number },
  intervalMs: number,
  json: boolean,
): Promise<void> {
  // Lazy import to avoid pulling SFN client when only `render --no-wait` is used.
  const { getRenderProgress } = await loadSDK();
  let lastRendered = -1;
  while (true) {
    const progress = await getRenderProgress({
      executionArn,
      region: stack.region,
      defaultMemorySizeMb: stack.lambdaMemoryMb,
    });
    if (!json && progress.framesRendered !== lastRendered) {
      lastRendered = progress.framesRendered;
      const total = progress.totalFrames ?? "?";
      const pct = Math.round(progress.overallProgress * 100);
      console.log(
        `  ${c.dim(`[${progress.status}]`)} ${pct}% • ${progress.framesRendered}/${total} frames • ${progress.costs.displayCost}`,
      );
    }
    if (progress.status !== "RUNNING") {
      if (json) {
        console.log(JSON.stringify(progress, null, 2));
      } else if (progress.status === "SUCCEEDED" && progress.outputFile) {
        console.log();
        console.log(c.success("Render complete."));
        console.log(`  ${c.dim("Output:")}        ${progress.outputFile.s3Uri}`);
        console.log(`  ${c.dim("Size:")}          ${progress.outputFile.bytes ?? "?"} bytes`);
        console.log(`  ${c.dim("Total cost:")}    ${progress.costs.displayCost}`);
      } else {
        console.log();
        console.log(c.error(`Render ended with status ${progress.status}.`));
        for (const err of progress.errors) {
          console.log(`  ${c.dim(err.state)}: ${err.error} — ${err.cause}`);
        }
        process.exitCode = 1;
      }
      return;
    }
    await sleep(intervalMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
