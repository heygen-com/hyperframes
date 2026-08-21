/**
 * Thin wrappers around the AWS SAM CLI used by `hyperframes lambda deploy`
 * and `hyperframes lambda destroy`.
 *
 * We shell out instead of programmatically driving the CloudFormation API
 * because:
 *   1. SAM handles the rollback-on-failure semantics correctly, including
 *      stuck-rollback recovery. Re-implementing that in TypeScript would
 *      duplicate a non-trivial chunk of the SAM CLI.
 *   2. The SAM template at `examples/aws-lambda/template.yaml` already
 *      describes the topology; adopters who customize the template
 *      shouldn't have to maintain it twice.
 *   3. SAM's `--resolve-s3` auto-creates an artifact bucket for the
 *      handler ZIP upload, which we'd otherwise have to re-implement.
 *
 * CDK adopters use `HyperframesRenderStack` directly from their own
 * CDK app — this CLI path is for users who don't want to write a CDK
 * project.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Throws with a clear hint when the SAM CLI is not on PATH. */
function assertSamAvailable(): void {
  try {
    execFileSync("sam", ["--version"], { stdio: "ignore" });
  } catch {
    throw new Error(
      "`sam` CLI not found on PATH. Install AWS SAM CLI from https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html and retry.",
    );
  }
}

/** Throws with a clear hint when the `aws` CLI is not on PATH. */
function assertAwsCliAvailable(): void {
  try {
    execFileSync("aws", ["--version"], { stdio: "ignore" });
  } catch {
    throw new Error(
      "`aws` CLI not found on PATH. Install from https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html and configure credentials before retrying.",
    );
  }
}

export interface DeployOptions {
  /** Repository root — the SAM template lives at `examples/aws-lambda/template.yaml` underneath. */
  repoRoot: string;
  /** CloudFormation stack name. */
  stackName: string;
  region: string;
  awsProfile?: string;
  reservedConcurrency?: number;
  /** Lambda memory in MB. Forwarded as the `LambdaMemoryMb` parameter override. */
  lambdaMemoryMb?: number;
  chromeSource?: "sparticuz" | "chrome-headless-shell";
  /** Pass-through stdio. Defaults to "inherit" so SAM's progress lines stream live. */
  stdio?: "inherit" | "pipe";
}

/**
 * Resolve the SAM template path relative to `repoRoot`. We look for the
 * `examples/aws-lambda/template.yaml` first (development checkout) and
 * fall back to the installed-package layout when running from a globally
 * installed `hyperframes` CLI.
 */
export function locateSamTemplate(repoRoot: string): string {
  const candidate = join(repoRoot, "examples", "aws-lambda", "template.yaml");
  if (!existsSync(candidate)) {
    throw new Error(
      `[lambda] SAM template not found at ${candidate}. ` +
        `If you're running from an installed package, point --sam-template at your local copy of examples/aws-lambda/template.yaml.`,
    );
  }
  return candidate;
}

/** Run `sam deploy` non-interactively. Returns when SAM exits 0; throws on non-zero. */
export function samDeploy(opts: DeployOptions): void {
  assertSamAvailable();
  const paramOverrides = [
    `ChromeSource=${opts.chromeSource ?? "sparticuz"}`,
    `ReservedConcurrency=${opts.reservedConcurrency ?? -1}`,
  ];
  if (opts.lambdaMemoryMb !== undefined) {
    paramOverrides.push(`LambdaMemoryMb=${opts.lambdaMemoryMb}`);
  }
  const args = [
    "deploy",
    "--stack-name",
    opts.stackName,
    "--region",
    opts.region,
    "--resolve-s3",
    "--capabilities",
    "CAPABILITY_IAM",
    "--no-confirm-changeset",
    "--no-fail-on-empty-changeset",
    "--parameter-overrides",
    ...paramOverrides,
  ];
  if (opts.awsProfile) {
    args.push("--profile", opts.awsProfile);
  }
  const samDir = join(opts.repoRoot, "examples", "aws-lambda");
  const result = spawnSync("sam", args, { cwd: samDir, stdio: opts.stdio ?? "inherit" });
  if (result.status !== 0) {
    throw new Error(
      `[lambda] sam deploy exited with code ${result.status ?? "unknown"}\n` +
        `If a prior attempt left a stack in ROLLBACK_COMPLETE, CloudFormation can't reuse it. ` +
        `Delete it before retrying:\n` +
        `  aws cloudformation delete-stack --stack-name aws-sam-cli-managed-default --region ${opts.region}\n` +
        `  aws cloudformation delete-stack --stack-name ${opts.stackName} --region ${opts.region}\n` +
        `(the first is SAM's managed artifacts stack from --resolve-s3; the second is the render stack).`,
    );
  }
}

/** Run `sam delete` non-interactively. */
export function samDelete(opts: {
  repoRoot: string;
  stackName: string;
  region: string;
  awsProfile?: string;
  stdio?: "inherit" | "pipe";
}): void {
  assertSamAvailable();
  const args = ["delete", "--stack-name", opts.stackName, "--region", opts.region, "--no-prompts"];
  if (opts.awsProfile) {
    args.push("--profile", opts.awsProfile);
  }
  const samDir = join(opts.repoRoot, "examples", "aws-lambda");
  const result = spawnSync("sam", args, { cwd: samDir, stdio: opts.stdio ?? "inherit" });
  if (result.status !== 0) {
    throw new Error(`[lambda] sam delete exited with code ${result.status ?? "unknown"}`);
  }
}

export interface StackOutputBag {
  bucketName: string;
  functionName: string;
  stateMachineArn: string;
}

/**
 * Query CloudFormation for the stack outputs the SAM template exports.
 * Used after `samDeploy` to populate the local state file.
 */
export function fetchStackOutputs(opts: {
  stackName: string;
  region: string;
  awsProfile?: string;
}): StackOutputBag {
  assertAwsCliAvailable();
  const args = [
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    opts.stackName,
    "--region",
    opts.region,
    "--query",
    "Stacks[0].Outputs",
    "--output",
    "json",
  ];
  if (opts.awsProfile) {
    args.unshift("--profile", opts.awsProfile);
  }
  const out = execFileSync("aws", args, { encoding: "utf-8" });
  const parsed = JSON.parse(out) as { OutputKey: string; OutputValue: string }[];
  const byKey = new Map(parsed.map((o) => [o.OutputKey, o.OutputValue]));
  const bucketName = byKey.get("RenderBucketName");
  const functionName = byKey.get("RenderFunctionArn");
  const stateMachineArn = byKey.get("RenderStateMachineArn");
  if (!bucketName || !functionName || !stateMachineArn) {
    throw new Error(
      `[lambda] stack ${opts.stackName} is missing one of RenderBucketName/RenderFunctionArn/RenderStateMachineArn. Got keys: ${[...byKey.keys()].join(", ")}`,
    );
  }
  return {
    bucketName,
    // RenderFunctionArn is the full ARN; the Lambda function name is the
    // last colon-segment, which downstream `getRenderProgress` calls use
    // for cost math + CloudWatch lookups.
    functionName: functionName.split(":").pop() ?? functionName,
    stateMachineArn,
  };
}
