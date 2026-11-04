/**
 * `hyperframes lambda deploy` — build the handler ZIP (or, outside a
 * checkout, fetch the adapter's pinned prebuilt one), sam-deploy the
 * Phase 6a SAM template, and persist the stack outputs locally so the
 * other lambda subcommands don't need re-derive them.
 *
 * Idempotent: re-running points at the same stack name and SAM resolves
 * the changeset to a no-op when nothing changed.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { c } from "../../ui/colors.js";
import { stagePrebuiltHandler } from "./prebuiltHandler.js";
import { fetchStackOutputs, locateSamTemplate, samDeploy } from "./sam.js";
import { repoRoot } from "./repoRoot.js";
import { DEFAULT_STACK_NAME, readStackOutputs, writeStackOutputs } from "./state.js";
import { pushVideoImage, type VideoArch } from "./videoImage.js";
import { warmFunction } from "./warm.js";

export interface DeployArgs {
  stackName: string;
  region: string;
  awsProfile?: string;
  /** -1 removes the reservation. Omitted: a redeploy keeps it; a new stack reserves none. */
  reservedConcurrency?: number;
  chromeSource: "sparticuz" | "chrome-headless-shell";
  lambdaMemoryMb: number;
  videoArch: VideoArch;
  /** Override the handler-ZIP rebuild step. Useful for CI runs that already built it. */
  skipBuild: boolean;
  warm: boolean;
}

const DEFAULT_REGION = "us-east-1";
const DEFAULT_MEMORY_MB = 10240;

export async function runDeploy(args: Partial<DeployArgs> = {}): Promise<void> {
  const resolved: DeployArgs = {
    stackName: args.stackName ?? DEFAULT_STACK_NAME,
    region: args.region ?? process.env.AWS_REGION ?? DEFAULT_REGION,
    awsProfile: args.awsProfile ?? process.env.AWS_PROFILE,
    reservedConcurrency: args.reservedConcurrency,
    chromeSource: args.chromeSource ?? "sparticuz",
    lambdaMemoryMb: args.lambdaMemoryMb ?? DEFAULT_MEMORY_MB,
    videoArch: args.videoArch ?? "arm64",
    skipBuild: args.skipBuild ?? false,
    warm: args.warm ?? true,
  };

  if (resolved.videoArch === "arm64" && resolved.chromeSource !== "sparticuz") {
    throw new Error(
      "[lambda deploy] The arm64 video image bundles sparticuz Chrome only. " +
        "Pass --video-arch x86_64 to deploy with --chrome-source chrome-headless-shell.",
    );
  }
  const root = repoRoot();
  const samDir = await prepareSamDir(root, resolved);
  const video =
    resolved.videoArch === "arm64"
      ? await pushVideoImage({
          stackName: resolved.stackName,
          region: resolved.region,
          inCheckout: root !== undefined,
        })
      : undefined;

  console.log(c.dim(`→ sam deploy (stack=${resolved.stackName} region=${resolved.region})`));
  samDeploy({
    samDir,
    stackName: resolved.stackName,
    region: resolved.region,
    awsProfile: resolved.awsProfile,
    reservedConcurrency: resolved.reservedConcurrency,
    lambdaMemoryMb: resolved.lambdaMemoryMb,
    chromeSource: resolved.chromeSource,
    videoImageUri: video?.imageUri,
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
    reservedConcurrency: outputs.reservedConcurrency,
    videoFunctionName: outputs.videoFunctionName,
    // Back on x86 the repository outlives the video function, so destroy still needs its name.
    videoRepository: video?.repositoryName ?? readStackOutputs(resolved.stackName)?.videoRepository,
    deployedAt: new Date().toISOString(),
  });

  warmVideoFunction(outputs.videoFunctionName, resolved);
  reportReservedConcurrency(outputs.reservedConcurrency, resolved);

  console.log();
  console.log(c.success("Stack deployed."));
  console.log(`  ${c.dim("Bucket:")}         ${outputs.bucketName}`);
  console.log(`  ${c.dim("State machine:")}  ${outputs.stateMachineArn}`);
  console.log(`  ${c.dim("Function:")}       ${outputs.functionName}`);
  if (outputs.videoFunctionName) {
    console.log(`  ${c.dim("Video function:")} ${outputs.videoFunctionName} (arm64)`);
  }
  console.log(`  ${c.dim("State file:")}     ${resolve(statePath)}`);
  console.log();
  console.log(c.dim(`Render with: hyperframes lambda render <project-dir>`));
}

function reportReservedConcurrency(kept: number | undefined, args: DeployArgs): void {
  if (args.reservedConcurrency === -1) {
    console.log(
      c.warn(
        "Removed the stack's reserved concurrency; each render now sizes itself to the account.",
      ),
    );
  } else if (args.reservedConcurrency === undefined && kept !== undefined) {
    console.log(
      c.warn(
        `Kept the stack's reserved concurrency of ${kept}. Pass --concurrency=N to change it.`,
      ),
    );
  }
}

function warmVideoFunction(functionName: string | undefined, args: DeployArgs): void {
  if (!args.warm || !functionName) return;
  console.log(c.dim("→ Warming up the video function"));
  try {
    warmFunction({ functionName, region: args.region, awsProfile: args.awsProfile });
  } catch (error) {
    console.log(c.warn(`Warm-up skipped, the deploy is fine: ${(error as Error).message}`));
  }
}

/** Checkout: build the ZIP from source. Otherwise: stage the adapter's pinned prebuilt ZIP. */
async function prepareSamDir(root: string | undefined, args: DeployArgs): Promise<string> {
  if (!root) {
    if (args.chromeSource !== "sparticuz") {
      throw new Error(
        "[lambda deploy] The prebuilt handler bundles sparticuz Chrome; --chrome-source=chrome-headless-shell needs a hyperframes checkout.",
      );
    }
    return stagePrebuiltHandler();
  }
  const samDir = dirname(locateSamTemplate(root));
  if (!args.skipBuild) {
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
  return samDir;
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
