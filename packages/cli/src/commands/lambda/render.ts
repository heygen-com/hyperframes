/**
 * `hyperframes lambda render <projectDir>` — start a distributed render
 * against the deployed stack. Wraps {@link renderToLambda}. Does NOT
 * poll — use `hyperframes lambda progress` for that.
 */

import { existsSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import type {
  DistributedFormat,
  SerializableDistributedRenderConfig,
} from "@hyperframes/aws-lambda/sdk";
import { c } from "../../ui/colors.js";
import {
  reportVariableIssues,
  resolveVariablesArg,
  validateVariablesAgainstProject,
} from "../../utils/variables.js";
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
  format: DistributedFormat;
  codec?: "h264" | "h265";
  quality?: "draft" | "standard" | "high";
  chunkSize?: number;
  maxParallelChunks?: number;
  executionName?: string;
  outputKey?: string;
  /** Inline JSON for `--variables '{...}'`. Mutually exclusive with `variablesFile`. */
  variables?: string;
  /** Path to a JSON file for `--variables-file ./vars.json`. */
  variablesFile?: string;
  /**
   * Fail the command if any `--variables` key is undeclared or has a wrong
   * type vs the composition's `data-composition-variables`. Without this
   * flag, mismatches are warnings (matches the local `hyperframes render`
   * behavior).
   */
  strictVariables?: boolean;
  /** Print machine-readable JSON instead of the human-friendly summary. */
  json: boolean;
  /** Block until the render finishes. Polls `progress` until SUCCEEDED/FAILED. */
  wait: boolean;
  /** Poll cadence in ms when `--wait` is set. */
  waitIntervalMs: number;
}

// fallow-ignore-next-line complexity
export async function runRender(args: RenderArgs): Promise<void> {
  const stack = requireStack(args.stackName);
  const projectDir = resolvePath(args.projectDir);

  // Resolve --variables / --variables-file using the same parser the local
  // `hyperframes render` uses. `resolveVariablesArg` exits(1) with a friendly
  // errorBox on parse errors so callers don't have to.
  const variables = resolveVariablesArg(args.variables, args.variablesFile);

  // Validate against the composition's `data-composition-variables`
  // declaration when present. The local CLI silently treats unreadable
  // index.html as "no declarations" — mirror that. Skip validation
  // entirely when the project dir is missing on disk (e.g. `--site-id`
  // pointing at a pre-uploaded site that was packaged on another machine).
  if (variables && Object.keys(variables).length > 0) {
    const indexPath = join(projectDir, "index.html");
    if (existsSync(indexPath)) {
      const issues = validateVariablesAgainstProject(indexPath, variables);
      // Suppress the warning block when --json is set; stdout is reserved
      // for the manifest. The strict-mode errorBox still prints to stderr
      // and exits, so machine consumers still get a non-zero exit.
      reportVariableIssues(issues, { strict: args.strictVariables ?? false, quiet: args.json });
    } else if (args.strictVariables && !args.json) {
      // --strict-variables asks for typed checking but there's no
      // index.html to check against (typical with --site-id pointing at a
      // pre-uploaded site). Make that silent skip visible so the flag
      // doesn't quietly become a no-op.
      console.warn(
        c.warn(
          `--strict-variables: no ${indexPath} on disk — schema validation skipped. ` +
            "Variables flow through unchecked. To enable strict checking, run from a project dir that contains the composition.",
        ),
      );
    }
  }

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
    variables,
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
