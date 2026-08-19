import { setCommandExitCode } from "../../utils/commandResult.js";
/**
 * `hyperframes lambda progress <executionArn>` — print a single progress
 * snapshot for a render. Wraps {@link getRenderProgress}. Accepts a
 * full executionArn or a renderId (in which case we resolve the arn
 * from the stack's region + state-machine name).
 */

import { c } from "../../ui/colors.js";
import { requireStack } from "./state.js";

export interface ProgressArgs {
  /** Full SFN execution ARN OR the renderId (== execution name). */
  target: string;
  stackName: string;
  json: boolean;
}

export async function runProgress(args: ProgressArgs): Promise<void> {
  const stack = requireStack(args.stackName);

  // Allow callers to pass either the full ARN or the renderId/exec name.
  // The state machine ARN is on the stack, so deriving the execution ARN
  // from a bare name is a deterministic suffix swap.
  const executionArn = args.target.startsWith("arn:")
    ? args.target
    : executionArnFromName(stack.stateMachineArn, args.target);

  // Dynamic-import the SDK so tsup keeps it out of the static-import head
  // of the CLI bundle. See sites.ts loadSDK() for the full rationale.
  const { getRenderProgress } = await import("@hyperframes/aws-lambda/sdk");
  const progress = await getRenderProgress({
    executionArn,
    region: stack.region,
    defaultMemorySizeMb: stack.lambdaMemoryMb,
  });

  if (args.json) {
    console.log(JSON.stringify(progress, null, 2));
    return;
  }

  const pct = Math.round(progress.overallProgress * 100);
  console.log(`${c.dim("Status:")}    ${statusColor(progress.status)}`);
  console.log(`${c.dim("Progress:")}  ${pct}%`);
  console.log(
    `${c.dim("Frames:")}    ${progress.framesRendered}${progress.totalFrames === null ? "" : ` / ${progress.totalFrames}`}`,
  );
  console.log(`${c.dim("Lambdas:")}   ${progress.lambdasInvoked}`);
  console.log(
    `${c.dim("Cost:")}      ${progress.costs.displayCost} (Lambda $${progress.costs.breakdown.lambdaUsd.toFixed(4)} + SFN $${progress.costs.breakdown.stepFunctionsUsd.toFixed(4)})`,
  );
  if (progress.outputFile) {
    console.log(`${c.dim("Output:")}    ${progress.outputFile.s3Uri}`);
  }
  if (progress.errors.length > 0) {
    console.log();
    console.log(c.error("Errors:"));
    for (const err of progress.errors) {
      console.log(`  ${c.dim(err.state)}: ${err.error} — ${err.cause}`);
    }
  }
  if (progress.fatalErrorEncountered) {
    setCommandExitCode(1);
  }
}

function executionArnFromName(stateMachineArn: string, name: string): string {
  // `arn:aws:states:<region>:<account>:stateMachine:<sm-name>` →
  // `arn:aws:states:<region>:<account>:execution:<sm-name>:<exec-name>`
  return stateMachineArn.replace(":stateMachine:", ":execution:") + `:${name}`;
}

function statusColor(status: string): string {
  switch (status) {
    case "SUCCEEDED":
      return c.success(status);
    case "FAILED":
    case "TIMED_OUT":
    case "ABORTED":
      return c.error(status);
    default:
      return status;
  }
}
