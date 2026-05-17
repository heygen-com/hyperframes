/**
 * Persists `hyperframes lambda` stack outputs (bucket, state-machine ARN,
 * region) so `render` / `progress` / `destroy` don't need to re-derive
 * them from CloudFormation on every call.
 *
 * Stored at `<cwd>/.hyperframes/lambda-stack-<stackName>.json`. Project-
 * local on purpose: a developer who runs `hyperframes lambda deploy` in
 * two different worktrees will get two distinct stack files, which is
 * the right default. If the user wants a shared default location, they
 * can symlink the directory.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface StackOutputs {
  /** Project-name prefix passed to `deploy`. Used as CloudFormation stack-name suffix. */
  stackName: string;
  region: string;
  bucketName: string;
  stateMachineArn: string;
  functionName: string;
  /** Lambda memory MB used during deploy; carried so cost math doesn't have to re-derive it. */
  lambdaMemoryMb: number;
  deployedAt: string;
}

const STATE_DIR_NAME = ".hyperframes";
const STATE_FILE_PREFIX = "lambda-stack-";
/**
 * Default CloudFormation stack name used when the caller doesn't pass
 * `--stack-name`. Centralised so deploy/destroy/sites/dispatcher all
 * agree on the literal `"hyperframes-default"`.
 */
export const DEFAULT_STACK_NAME = "hyperframes-default";

export function stateFilePath(
  stackName: string = DEFAULT_STACK_NAME,
  cwd: string = process.cwd(),
): string {
  return join(cwd, STATE_DIR_NAME, `${STATE_FILE_PREFIX}${stackName}.json`);
}

export function writeStackOutputs(outputs: StackOutputs, cwd: string = process.cwd()): string {
  const path = stateFilePath(outputs.stackName, cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(outputs, null, 2) + "\n");
  return path;
}

export function readStackOutputs(
  stackName: string = DEFAULT_STACK_NAME,
  cwd: string = process.cwd(),
): StackOutputs | null {
  const path = stateFilePath(stackName, cwd);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as StackOutputs;
  } catch {
    return null;
  }
}

export function deleteStackOutputs(
  stackName: string = DEFAULT_STACK_NAME,
  cwd: string = process.cwd(),
): void {
  const path = stateFilePath(stackName, cwd);
  if (existsSync(path)) rmSync(path);
}

export function listStackNames(cwd: string = process.cwd()): string[] {
  const dir = join(cwd, STATE_DIR_NAME);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith(STATE_FILE_PREFIX) && f.endsWith(".json"))
    .map((f) => f.slice(STATE_FILE_PREFIX.length, -".json".length));
}

/**
 * Read stack outputs or print a helpful error and exit. Shared between
 * `render`, `progress`, and `destroy` so the "did you run `deploy` first?"
 * hint is consistent.
 */
export function requireStack(stackName: string, cwd: string = process.cwd()): StackOutputs {
  const stack = readStackOutputs(stackName, cwd);
  if (!stack) {
    const known = listStackNames(cwd);
    let hint = `Run \`hyperframes lambda deploy${stackName === DEFAULT_STACK_NAME ? "" : ` --stack-name=${stackName}`}\` first.`;
    if (known.length) {
      hint += ` Known stacks here: ${known.join(", ")}.`;
    }
    console.error(
      `[hyperframes lambda] no stack state for "${stackName}" at ${stateFilePath(stackName, cwd)}. ${hint}`,
    );
    process.exit(1);
  }
  return stack;
}
