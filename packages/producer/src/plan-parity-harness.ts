import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { analyzePlanParityDriverResult } from "./plan-parity-analysis.js";
import {
  comparePlanParityMeasurements,
  type PlanParityComparison,
  type PlanParityComparisonOptions,
  type PlanParityDriver,
  type PlanParityDriverResult,
  type PlanParityMeasurement,
  type PlanParityRenderConfig,
} from "./plan-parity-contract.js";
import { preparePlanParityFixture } from "./plan-parity-fixture.js";

export type PlanParityTarget = "lambda-local" | `aws:${string}`;

export interface RunPlanProtocolParityOptions {
  fixtureDir: string;
  artifactsDir: string;
  v1Driver: PlanParityDriver;
  v2Driver: PlanParityDriver;
  renderConfig: PlanParityRenderConfig;
  v1PlanSizeCapBytes?: number;
  comparison?: PlanParityComparisonOptions;
}

export interface PlanParityCliOptions {
  fixtureDir: string;
  artifactsDir: string;
  v1Target: PlanParityTarget;
  v2Target: PlanParityTarget;
  renderConfig: PlanParityRenderConfig;
  v1PlanSizeCapBytes?: number;
  expectV1PlanTooLarge: boolean;
  comparison: PlanParityComparisonOptions;
}

export interface RunPlanV2SizePressureOptions {
  fixtureDir: string;
  artifactsDir: string;
  driver: PlanParityDriver;
  renderConfig: PlanParityRenderConfig;
  v1PlanSizeCapBytes: number;
  /**
   * Test seam for the post-render media analyzer. Production callers use
   * the canonical ffmpeg/ffprobe analyzer.
   */
  analyzeDriverResult?: (
    driverName: string,
    result: PlanParityDriverResult,
  ) => Promise<PlanParityMeasurement>;
}

export type PlanTooLargeProbeOutcome =
  | {
      status: "expected-failure";
      code: "PLAN_TOO_LARGE";
      message: string;
      sizeBytes: number | null;
      limitBytes: number | null;
    }
  | {
      status: "unexpected-success";
      message: string;
    }
  | {
      status: "unexpected-failure";
      code: string | null;
      message: string;
    };

export type PlanV2PressureOutcome =
  | {
      status: "success";
      measurement: PlanParityMeasurement;
    }
  | {
      status: "failure";
      message: string;
    };

export interface PlanV2SizePressureReport {
  passed: boolean;
  checks: Array<{
    name: "v1-plan-too-large" | "v2-render-success";
    passed: boolean;
    detail: string;
  }>;
  v1: PlanTooLargeProbeOutcome;
  v2: PlanV2PressureOutcome;
}

function parsePositiveInteger(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`plan parity: --${name} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeNumber(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`plan parity: --${name} must be a non-negative finite number`);
  }
  return parsed;
}

function parseBoolean(name: string, value: string | undefined): boolean {
  if (value === undefined || value === "true") return true;
  if (value === "false") return false;
  throw new Error(`plan parity: --${name} must be true or false`);
}

function parseTarget(name: string, value: string | undefined): PlanParityTarget {
  const target = value ?? "lambda-local";
  if (target === "lambda-local") return target;
  if (target.startsWith("aws:") && target.length > "aws:".length) {
    return target as `aws:${string}`;
  }
  throw new Error(
    `plan parity: --${name} must be lambda-local or aws:<isolated-stack> (got ${JSON.stringify(target)})`,
  );
}

function collectArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) {
      throw new Error(`plan parity: unexpected positional argument ${JSON.stringify(token)}`);
    }
    const equals = token.indexOf("=");
    if (equals > 2) {
      args.set(token.slice(2, equals), token.slice(equals + 1));
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, "true");
      continue;
    }
    args.set(key, next);
    index += 1;
  }
  return args;
}

export function parsePlanParityArgs(argv: string[]): PlanParityCliOptions {
  const args = collectArgs(argv);
  const fixtureDir = resolve(args.get("fixture") ?? "fixtures/plan-parity-visual-audio");
  const artifactsDir = resolve(args.get("artifacts-dir") ?? ".debug/plan-protocol-parity");
  const fps = parsePositiveInteger("fps", args.get("fps")) ?? 30;
  if (fps !== 24 && fps !== 30 && fps !== 60) {
    throw new Error("plan parity: --fps must be 24, 30, or 60");
  }

  return {
    fixtureDir,
    artifactsDir,
    v1Target: parseTarget("v1-target", args.get("v1-target")),
    v2Target: parseTarget("v2-target", args.get("v2-target")),
    renderConfig: {
      fps,
      width: parsePositiveInteger("width", args.get("width")) ?? 320,
      height: parsePositiveInteger("height", args.get("height")) ?? 180,
      format: "mp4",
      chunkSize: parsePositiveInteger("chunk-size", args.get("chunk-size")),
      maxParallelChunks: parsePositiveInteger(
        "max-parallel-chunks",
        args.get("max-parallel-chunks"),
      ),
    },
    v1PlanSizeCapBytes: parsePositiveInteger(
      "v1-plan-size-cap-bytes",
      args.get("v1-plan-size-cap-bytes"),
    ),
    expectV1PlanTooLarge:
      args.get("expect-v1-plan-too-large") === undefined
        ? false
        : parseBoolean("expect-v1-plan-too-large", args.get("expect-v1-plan-too-large")),
    comparison: {
      durationToleranceSeconds: parseNonNegativeNumber(
        "duration-tolerance-seconds",
        args.get("duration-tolerance-seconds"),
      ),
      requireEncodedOutputEquality:
        args.get("strict-encoded-output") === undefined
          ? false
          : parseBoolean("strict-encoded-output", args.get("strict-encoded-output")),
      maxV2TransferBytes: parsePositiveInteger(
        "max-v2-transfer-bytes",
        args.get("max-v2-transfer-bytes"),
      ),
      maxV2PeakMaterializedBytes: parsePositiveInteger(
        "max-v2-peak-materialized-bytes",
        args.get("max-v2-peak-materialized-bytes"),
      ),
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorCode(error: unknown): string | null {
  if (isRecord(error) && typeof error.code === "string") {
    return error.code;
  }
  return null;
}

function errorNumber(error: unknown, field: "sizeBytes" | "limitBytes"): number | null {
  if (isRecord(error)) {
    const value = error[field];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

export function classifyPlanTooLargeProbeFailure(error: unknown): PlanTooLargeProbeOutcome {
  const code = errorCode(error);
  if (code === "PLAN_TOO_LARGE") {
    return {
      status: "expected-failure",
      code,
      message: errorMessage(error),
      sizeBytes: errorNumber(error, "sizeBytes"),
      limitBytes: errorNumber(error, "limitBytes"),
    };
  }
  return {
    status: "unexpected-failure",
    code,
    message: errorMessage(error),
  };
}

/**
 * Prove the migration boundary directly:
 *
 * 1. explicit v1 with a deliberately low cap must fail PLAN_TOO_LARGE;
 * 2. explicit v2 must still run to completion for the same prepared fixture.
 *
 * Unlike semantic parity mode, this API does not compare v1/v2 output because
 * the expected v1 run never produces output. Its durable report records both
 * the typed failure and the fully analyzed v2 success.
 */
export async function runPlanV2SizePressure(
  options: RunPlanV2SizePressureOptions,
): Promise<PlanV2SizePressureReport> {
  if (!existsSync(options.fixtureDir)) {
    throw new Error(`plan parity fixture does not exist: ${options.fixtureDir}`);
  }
  mkdirSync(options.artifactsDir, { recursive: true });
  const v1ProjectDir = resolve(options.artifactsDir, "v1-low-cap", "project");
  const v2ProjectDir = resolve(options.artifactsDir, "v2", "project");
  preparePlanParityFixture(options.fixtureDir, v1ProjectDir);
  preparePlanParityFixture(options.fixtureDir, v2ProjectDir);

  let v1: PlanTooLargeProbeOutcome;
  try {
    await options.driver.render({
      protocol: "v1",
      projectDir: v1ProjectDir,
      outputDir: resolve(options.artifactsDir, "v1-low-cap", "run"),
      renderConfig: options.renderConfig,
      planSizeCapBytes: options.v1PlanSizeCapBytes,
    });
    v1 = {
      status: "unexpected-success",
      message: `v1 rendered despite plan cap ${options.v1PlanSizeCapBytes}`,
    };
  } catch (error) {
    v1 = classifyPlanTooLargeProbeFailure(error);
  }

  let v2: PlanV2PressureOutcome;
  try {
    const result = await options.driver.render({
      protocol: "v2",
      projectDir: v2ProjectDir,
      outputDir: resolve(options.artifactsDir, "v2", "run"),
      renderConfig: options.renderConfig,
    });
    const analyze = options.analyzeDriverResult ?? analyzePlanParityDriverResult;
    v2 = {
      status: "success",
      measurement: await analyze(options.driver.name, result),
    };
  } catch (error) {
    v2 = {
      status: "failure",
      message: errorMessage(error),
    };
  }

  const checks: PlanV2SizePressureReport["checks"] = [
    {
      name: "v1-plan-too-large",
      passed: v1.status === "expected-failure",
      detail:
        v1.status === "expected-failure"
          ? `PLAN_TOO_LARGE size=${v1.sizeBytes ?? "unknown"} limit=${v1.limitBytes ?? "unknown"}`
          : v1.message,
    },
    {
      name: "v2-render-success",
      passed: v2.status === "success",
      detail:
        v2.status === "success"
          ? `${v2.measurement.media.frameSha256.length} frames, ${v2.measurement.media.outputBytes} output bytes`
          : v2.message,
    },
  ];
  const report: PlanV2SizePressureReport = {
    passed: checks.every((entry) => entry.passed),
    checks,
    v1,
    v2,
  };
  writeFileSync(
    resolve(options.artifactsDir, "plan-too-large-v2-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf-8",
  );
  return report;
}

/**
 * Run the same prepared project through explicit v1 and v2 drivers, analyze
 * their artifacts, and persist a machine-readable comparison report.
 */
export async function runPlanProtocolParity(
  options: RunPlanProtocolParityOptions,
): Promise<PlanParityComparison> {
  if (!existsSync(options.fixtureDir)) {
    throw new Error(`plan parity fixture does not exist: ${options.fixtureDir}`);
  }
  mkdirSync(options.artifactsDir, { recursive: true });

  const v1ProjectDir = resolve(options.artifactsDir, "v1", "project");
  const v2ProjectDir = resolve(options.artifactsDir, "v2", "project");
  preparePlanParityFixture(options.fixtureDir, v1ProjectDir);
  preparePlanParityFixture(options.fixtureDir, v2ProjectDir);

  const v1Result = await options.v1Driver.render({
    protocol: "v1",
    projectDir: v1ProjectDir,
    outputDir: resolve(options.artifactsDir, "v1", "run"),
    renderConfig: options.renderConfig,
    planSizeCapBytes: options.v1PlanSizeCapBytes,
  });
  const v2Result = await options.v2Driver.render({
    protocol: "v2",
    projectDir: v2ProjectDir,
    outputDir: resolve(options.artifactsDir, "v2", "run"),
    renderConfig: options.renderConfig,
  });
  const [v1, v2] = await Promise.all([
    analyzePlanParityDriverResult(options.v1Driver.name, v1Result),
    analyzePlanParityDriverResult(options.v2Driver.name, v2Result),
  ]);
  const comparison = comparePlanParityMeasurements(v1, v2, options.comparison);
  writeFileSync(
    resolve(options.artifactsDir, "comparison.json"),
    `${JSON.stringify(comparison, null, 2)}\n`,
    "utf-8",
  );
  return comparison;
}

interface LambdaLocalDriverModule {
  createLambdaLocalPlanParityDriver(): PlanParityDriver;
}

function isLambdaLocalDriverModule(value: unknown): value is LambdaLocalDriverModule {
  return (
    typeof value === "object" &&
    value !== null &&
    "createLambdaLocalPlanParityDriver" in value &&
    typeof value.createLambdaLocalPlanParityDriver === "function"
  );
}

async function loadDriver(target: PlanParityTarget): Promise<PlanParityDriver> {
  if (target.startsWith("aws:")) {
    throw new Error(
      `plan parity target ${target} requires the deployed-AWS driver package; ` +
        "use the library API to inject that driver until it is installed",
    );
  }
  // Indirect path keeps producer's build from pulling @hyperframes/aws-lambda
  // into its declaration emit before that workspace package has built.
  const modulePath = "./plan-parity-lambda-local-driver.js";
  const loaded: unknown = await import(modulePath);
  if (!isLambdaLocalDriverModule(loaded)) {
    throw new Error("lambda-local parity driver module has an invalid shape");
  }
  return loaded.createLambdaLocalPlanParityDriver();
}

async function main(): Promise<void> {
  const options = parsePlanParityArgs(process.argv);
  if (options.expectV1PlanTooLarge) {
    if (options.v1PlanSizeCapBytes === undefined) {
      throw new Error("plan parity: --expect-v1-plan-too-large requires --v1-plan-size-cap-bytes");
    }
    if (options.v1Target !== options.v2Target) {
      throw new Error(
        "plan parity: pressure mode requires the same target for its v1 probe and v2 proof",
      );
    }
    const report = await runPlanV2SizePressure({
      fixtureDir: options.fixtureDir,
      artifactsDir: options.artifactsDir,
      driver: await loadDriver(options.v1Target),
      renderConfig: options.renderConfig,
      v1PlanSizeCapBytes: options.v1PlanSizeCapBytes,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.passed) process.exitCode = 1;
    return;
  }
  const comparison = await runPlanProtocolParity({
    fixtureDir: options.fixtureDir,
    artifactsDir: options.artifactsDir,
    v1Driver: await loadDriver(options.v1Target),
    v2Driver: await loadDriver(options.v2Target),
    renderConfig: options.renderConfig,
    v1PlanSizeCapBytes: options.v1PlanSizeCapBytes,
    comparison: options.comparison,
  });
  process.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`);
  if (!comparison.passed) process.exitCode = 1;
}

const isDirectRun =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isDirectRun) {
  await main();
}
