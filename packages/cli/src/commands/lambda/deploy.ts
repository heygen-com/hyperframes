/**
 * `hyperframes lambda deploy` — build the handler ZIP, sam-deploy the
 * Phase 6a SAM template, and persist the stack outputs locally so the
 * other lambda subcommands don't need re-derive them.
 *
 * Idempotent: re-running points at the same stack name and SAM resolves
 * the changeset to a no-op when nothing changed.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { c } from "../../ui/colors.js";
import { fetchStackOutputs, locateSamTemplate, samDeploy } from "./sam.js";
import { repoRoot } from "./repoRoot.js";
import { DEFAULT_STACK_NAME, writeStackOutputs } from "./state.js";

export interface DeployArgs {
  stackName: string;
  region: string;
  awsProfile?: string;
  reservedConcurrency: number;
  chromeSource: "sparticuz" | "chrome-headless-shell";
  lambdaMemoryMb: number;
  /** Override the handler-ZIP rebuild step. Useful for CI runs that already built it. */
  skipBuild: boolean;
}

const DEFAULT_REGION = "us-east-1";
const DEFAULT_MEMORY_MB = 10240;
// Low default reserved-concurrency so a first-time user doesn't get
// surprise-billed by a runaway Map state. Adopters with their own quota
// raise this explicitly via `--concurrency`.
const DEFAULT_CONCURRENCY = 8;

export async function runDeploy(args: Partial<DeployArgs> = {}): Promise<void> {
  const resolved: DeployArgs = {
    stackName: args.stackName ?? DEFAULT_STACK_NAME,
    region: args.region ?? process.env.AWS_REGION ?? DEFAULT_REGION,
    awsProfile: args.awsProfile ?? process.env.AWS_PROFILE,
    reservedConcurrency: args.reservedConcurrency ?? DEFAULT_CONCURRENCY,
    chromeSource: args.chromeSource ?? "sparticuz",
    lambdaMemoryMb: args.lambdaMemoryMb ?? DEFAULT_MEMORY_MB,
    skipBuild: args.skipBuild ?? false,
  };

  const root = repoRoot();
  // Locate the SAM template up-front so users get a fast, clear error
  // (not an opaque `sam deploy` failure) when this isn't a checkout.
  locateSamTemplate(root);

  if (!resolved.skipBuild) {
    console.log(c.dim("→ Building handler ZIP"));
    buildHandlerZip(root);
  } else {
    const zip = join(root, "packages", "aws-lambda", "dist", "handler.zip");
    if (!existsSync(zip)) {
      throw new Error(
        `--skip-build set but ${zip} does not exist. Run \`bun run --cwd packages/aws-lambda build:zip\` first or drop --skip-build.`,
      );
    }
  }

  console.log(c.dim(`→ sam deploy (stack=${resolved.stackName} region=${resolved.region})`));
  samDeploy({
    repoRoot: root,
    stackName: resolved.stackName,
    region: resolved.region,
    awsProfile: resolved.awsProfile,
    reservedConcurrency: resolved.reservedConcurrency,
    lambdaMemoryMb: resolved.lambdaMemoryMb,
    chromeSource: resolved.chromeSource,
  });

  console.log(c.dim("→ Reading stack outputs"));
  const outputs = fetchStackOutputs({
    stackName: resolved.stackName,
    region: resolved.region,
    awsProfile: resolved.awsProfile,
  });

  const statePath = writeStackOutputs({
    stackName: resolved.stackName,
    region: resolved.region,
    bucketName: outputs.bucketName,
    stateMachineArn: outputs.stateMachineArn,
    functionName: outputs.functionName,
    lambdaMemoryMb: resolved.lambdaMemoryMb,
    deployedAt: new Date().toISOString(),
  });

  console.log();
  console.log(c.success("Stack deployed."));
  console.log(`  ${c.dim("Bucket:")}         ${outputs.bucketName}`);
  console.log(`  ${c.dim("State machine:")}  ${outputs.stateMachineArn}`);
  console.log(`  ${c.dim("Function:")}       ${outputs.functionName}`);
  console.log(`  ${c.dim("State file:")}     ${resolve(statePath)}`);
  console.log();
  console.log(c.dim(`Render with: hyperframes lambda render <project-dir>`));
}

function buildHandlerZip(root: string): void {
  // bun run --cwd packages/aws-lambda build:zip
  const result = spawnSync(
    "bun",
    ["run", "--cwd", join(root, "packages", "aws-lambda"), "build:zip"],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error(
      `[lambda deploy] handler ZIP build exited with code ${result.status ?? "unknown"}`,
    );
  }
}
