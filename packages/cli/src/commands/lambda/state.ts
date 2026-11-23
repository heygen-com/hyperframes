import { failCommand } from "../../utils/commandResult.js";
import { terminalText } from "@hyperframes/core";
/**
 * Persists `hyperframes lambda` stack outputs (bucket, state-machine ARN,
 * region) so `render` / `progress` / `destroy` don't need to re-derive
 * them from CloudFormation on every call.
 *
 * Stored at `<cwd>/.hyperframes/lambda-stack-<stackName>.json`. Project-
 * local on purpose: a developer who runs `hyperframes lambda deploy` in
 * two different worktrees will get two distinct stack files, which is
 * the right default. The file arrives with any project someone else sent, so
 * it is read only as a plain file and each field is checked before use.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  readRecordTail,
  recordKind,
  removeRecord,
  writeRecord,
} from "../../utils/projectRecords.js";

export interface StackOutputs {
  /** Project-name prefix passed to `deploy`. Used as CloudFormation stack-name suffix. */
  stackName: string;
  region: string;
  bucketName: string;
  stateMachineArn: string;
  functionName: string;
  /** Lambda memory MB used during deploy; carried so cost math doesn't have to re-derive it. */
  lambdaMemoryMb: number;
  reservedConcurrency?: number;
  videoFunctionName?: string;
  videoRepository?: string;
  deployedAt: string;
}

export function videoArchitecture(stack: StackOutputs): "arm64" | undefined {
  return stack.videoFunctionName ? "arm64" : undefined;
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
  const name = `${STATE_FILE_PREFIX}${outputs.stackName}.json`;
  if (!writeRecord(cwd, name, JSON.stringify(outputs, null, 2) + "\n"))
    throw new Error(`Could not write ${path}: it, or .hyperframes, is a link or not a plain file`);
  return path;
}

const MAX_STATE_BYTES = 64 * 1024;
const REGION = /^[a-z]{2}(?:-[a-z]+)+-\d$/;
const BUCKET = /^(?!xn--)(?!.*\.\.)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const STATE_MACHINE_ARN =
  /^arn:aws(?:-cn|-us-gov)?:states:([a-z]{2}(?:-[a-z]+)+-\d):\d{12}:stateMachine:[\w-]{1,80}$/;
const FUNCTION_NAME = /^[\w-]{1,64}$/;

const isText = (value: unknown, shape: RegExp): value is string =>
  typeof value === "string" && shape.test(value);
const optional = (valid: (value: unknown) => boolean) => (value: unknown) =>
  value === undefined || valid(value);
const isCount = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value > 0;
const isFunctionName = (value: unknown) => isText(value, FUNCTION_NAME);

const FIELD_CHECKS: [keyof StackOutputs, (value: unknown) => boolean][] = [
  ["stackName", (value) => typeof value === "string"],
  ["region", (value) => isText(value, REGION)],
  ["bucketName", (value) => isText(value, BUCKET)],
  ["stateMachineArn", (value) => isText(value, STATE_MACHINE_ARN)],
  ["functionName", isFunctionName],
  ["lambdaMemoryMb", isCount],
  ["reservedConcurrency", optional(isCount)],
  ["videoFunctionName", optional(isFunctionName)],
  ["videoRepository", optional((value) => typeof value === "string")],
];

/** Why `value` is not the outputs `lambda deploy` writes, or null when it is. */
function stackOutputsProblem(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return "is not a JSON object";
  const stack: Partial<Record<keyof StackOutputs, unknown>> = value;
  const invalid = FIELD_CHECKS.find(([field, valid]) => !valid(stack[field]));
  if (invalid) return `has no valid ${invalid[0]}`;
  const arnRegion = STATE_MACHINE_ARN.exec(String(stack.stateMachineArn))?.[1];
  return arnRegion === stack.region
    ? null
    : `names region ${stack.region} but a state machine in ${arnRegion}`;
}

/** The stack file's outputs; null when there is none; why it cannot be used when it is a link or malformed. */
function loadStackOutputs(stackName: string, cwd: string): StackOutputs | string | null {
  const name = `${STATE_FILE_PREFIX}${stackName}.json`;
  if (recordKind(cwd, name) === "absent") return null;
  const record = readRecordTail(cwd, name, MAX_STATE_BYTES);
  if (!record) return "is a link or not a plain file in a real .hyperframes folder";
  if (!record.whole) return "is too large";
  let value: unknown;
  try {
    value = JSON.parse(record.text);
  } catch {
    return "is not valid JSON";
  }
  return stackOutputsProblem(value) ?? (value as StackOutputs);
}

export function readStackOutputs(
  stackName: string = DEFAULT_STACK_NAME,
  cwd: string = process.cwd(),
): StackOutputs | null {
  const stack = loadStackOutputs(stackName, cwd);
  return typeof stack === "string" ? null : stack;
}

export function deleteStackOutputs(
  stackName: string = DEFAULT_STACK_NAME,
  cwd: string = process.cwd(),
): void {
  removeRecord(cwd, `${STATE_FILE_PREFIX}${stackName}.json`);
}

export function listStackNames(cwd: string = process.cwd()): string[] {
  const dir = join(cwd, STATE_DIR_NAME);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith(STATE_FILE_PREFIX) && f.endsWith(".json"))
    .map((f) => f.slice(STATE_FILE_PREFIX.length, -".json".length));
}

const sameFileOnCaseInsensitiveDisk = (a: string, b: string): boolean =>
  a.toLowerCase() === b.toLowerCase();

/**
 * Read stack outputs or print a helpful error and exit. Shared between
 * `render`, `progress`, and `destroy` so the "did you run `deploy` first?"
 * hint is consistent.
 */
export function requireStack(stackName: string, cwd: string = process.cwd()): StackOutputs {
  const stack = loadStackOutputs(stackName, cwd);
  const path = stateFilePath(stackName, cwd);
  const deploy = `Run \`hyperframes lambda deploy${stackName === DEFAULT_STACK_NAME ? "" : ` --stack-name=${stackName}`}\``;
  if (typeof stack === "string") {
    console.error(terminalText(`[hyperframes lambda] ${path} ${stack}. ${deploy} to rewrite it.`));
    failCommand();
  }
  if (!stack) {
    const known = listStackNames(cwd);
    const hint = known.length ? ` Known stacks here: ${known.join(", ")}.` : "";
    console.error(
      terminalText(
        `[hyperframes lambda] no stack state for "${stackName}" at ${path}. ${deploy} first.${hint}`,
      ),
    );
    failCommand();
  }
  if (!sameFileOnCaseInsensitiveDisk(String(stack.stackName), stackName)) {
    console.error(
      terminalText(
        `[hyperframes lambda] ${path} names stack "${stack.stackName}", not "${stackName}". ${deploy} to rewrite it.`,
      ),
    );
    failCommand();
  }
  return stack;
}
