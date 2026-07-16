/**
 * `hyperframes lambda render-batch <projectDir> --batch <path.jsonl>` —
 * fan out N personalised renders of the same project, one per JSONL line.
 *
 * The headline ergonomic for automated template-rendering pipelines on
 * Lambda: deploy the site once (or accept a `--site-id` to skip), then
 * call `renderToLambda` for each batch entry with per-entry `variables`
 * and `outputKey`. Concurrent Step Functions executions are capped at
 * `--max-concurrent` (default 50) via a semaphore so a 10 000-entry batch
 * file doesn't try to start 10 000 executions simultaneously and trip the
 * AWS account's concurrent-execution limit.
 *
 * Per-entry results land in a manifest: one row per input line with the
 * `executionArn` + status. `--dry-run` skips the AWS calls and prints the
 * manifest with `status: "would-invoke"` for each entry so callers can
 * lint their batch file without paying for any executions.
 *
 * JSONL format (one JSON object per line):
 *
 *     {"outputKey": "renders/alice.mp4", "variables": {"name": "Alice"}}
 *     {"outputKey": "renders/bob.mp4",   "variables": {"name": "Bob"}}
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import type {
  DistributedFormat,
  SerializableDistributedRenderConfig,
  SiteHandle,
} from "@hyperframes/aws-lambda/sdk";
import type { CanvasResolution } from "@hyperframes/core";
import { c } from "../../ui/colors.js";
import { errorBox } from "../../ui/format.js";
import {
  loadProjectVariableSchema,
  reportVariableIssues,
  validateVariablesAgainstSchema,
} from "../../utils/variables.js";
import { normalizeErrorMessage } from "../../utils/errorMessage.js";
import { warnOnDimensionMismatch } from "./_dimensions.js";
import { requireStack } from "./state.js";

// Dynamic-import the SDK so tsup keeps it out of the static-import head of
// the CLI bundle. See sites.ts loadSDK() for the full rationale.
async function loadSDK(): Promise<typeof import("@hyperframes/aws-lambda/sdk")> {
  return import("@hyperframes/aws-lambda/sdk");
}

/** Arguments accepted by `hyperframes lambda render-batch`. */
export interface RenderBatchArgs {
  projectDir: string;
  stackName: string;
  /** Path to the JSONL batch file. Each line is a {@link BatchEntry}. */
  batch: string;
  /**
   * Skip the project upload and re-use an existing pre-deployed site. The
   * batch verb deploys the site once and reuses it across renders by
   * default — this flag is for cases where the site was uploaded by a
   * separate `sites create` step (CI / cross-machine).
   */
  siteId?: string;
  /** Composition config — fps/width/height/format required, rest optional. */
  fps: 24 | 30 | 60;
  width: number;
  height: number;
  /** See {@link RenderArgs.outputResolution}. */
  outputResolution?: CanvasResolution;
  /**
   * See {@link RenderArgs.outputResolutionAspectAgnostic}. Threaded through
   * `SerializableDistributedRenderConfig` so the Lambda worker's compile
   * stage remaps aspect-agnostic aliases (`1080p` / `hd` / `4k` / `uhd`) to
   * the composition's orientation — same regression class as the local CLI.
   */
  outputResolutionAspectAgnostic?: boolean;
  format: DistributedFormat;
  codec?: "h264" | "h265";
  quality?: "draft" | "standard" | "high";
  chunkSize?: number;
  maxParallelChunks?: number;
  targetChunkFrames?: number;
  /**
   * Maximum in-flight Step Functions starts at any moment. Caps fan-out
   * so a 10 000-entry batch doesn't try to spawn 10 000 executions
   * simultaneously. Defaults to 50.
   *
   * Distinct from `maxParallelChunks` (which caps chunks PER render).
   * Lambda concurrent-execution limits live one level up at the AWS
   * account level and this CLI cannot enforce those; the cap here is
   * purely orchestrator-side.
   */
  maxConcurrent?: number;
  /**
   * `--strict-variables` applies to every batch entry's pre-validation.
   * Mismatches print as warnings; in strict mode the first failing entry
   * aborts the run before any AWS call.
   */
  strictVariables?: boolean;
  /**
   * Don't actually invoke `renderToLambda`. Print the manifest with
   * `status: "would-invoke"` for every entry. Used to lint the batch
   * file before committing to N billable executions.
   */
  dryRun?: boolean;
  /** Print machine-readable JSON instead of the human-friendly summary. */
  json: boolean;
}

/**
 * A single line in the JSONL batch file. Each entry produces one Step
 * Functions execution with the supplied `variables` injected into the
 * composition's `window.__hfVariables`.
 */
export interface BatchEntry {
  /**
   * Final output S3 key for this entry's render. Per-entry so the caller
   * controls the output layout (e.g. `renders/users/alice.mp4`). Without
   * an explicit value the SDK falls back to its
   * `renders/<executionName>/output.<ext>` default, which makes a 100-row
   * batch unreadable.
   */
  outputKey: string;
  /**
   * Variable overrides for this entry. Merged over the composition's
   * declared defaults inside the chunk worker (via
   * `window.__hfVariables`). Optional — pass `{}` if a row needs the
   * composition's defaults verbatim.
   */
  variables?: Record<string, unknown>;
  /**
   * Optional explicit Step Functions execution name. Defaults to
   * `hf-render-<uuid>` (generated by the SDK). Useful when the caller
   * wants to correlate batch rows with downstream systems.
   */
  executionName?: string;
}

/** Single row of the manifest emitted by `render-batch`. */
interface BatchManifestEntry {
  /** 1-based index of the source JSONL line (after blank-line stripping). */
  inputLine: number;
  /** Output S3 key the SDK was asked to produce. */
  outputKey: string;
  /**
   * SFN execution ARN, or `null` for entries that failed-to-start or were
   * `--dry-run`-skipped. The latter case has `status: "would-invoke"`.
   */
  executionArn: string | null;
  /** Stable status discriminator the caller's manifest consumer can switch on. */
  status: "started" | "would-invoke" | "failed-to-start";
  /** Error message when `status === "failed-to-start"`. */
  error?: string;
}

const DEFAULT_MAX_CONCURRENT = 50;

/**
 * Run the batch render. Throws on usage errors (bad CLI flags, missing
 * project dir, malformed batch file); per-entry failures are captured in
 * the manifest with `status: "failed-to-start"` rather than aborting the
 * whole batch.
 */
// fallow-ignore-next-line complexity
export async function runRenderBatch(args: RenderBatchArgs): Promise<void> {
  const projectDir = resolvePath(args.projectDir);
  const stack = requireStack(args.stackName);

  const batchPath = resolvePath(args.batch);
  if (!existsSync(batchPath)) {
    errorBox("Batch file not found", `No such file: ${batchPath}`);
    process.exit(1);
  }
  const entries = parseBatchFile(batchPath);
  if (entries.length === 0) {
    errorBox("Empty batch", `${batchPath} contains zero entries (every line was blank).`);
    process.exit(1);
  }

  warnOnDimensionMismatch({
    projectDir,
    cliWidth: args.width,
    cliHeight: args.height,
    outputResolution: args.outputResolution,
    quiet: args.json,
  });

  // Pre-validate every entry's variables against the composition's
  // schema. Mismatches print as warnings; strict mode aborts before any
  // AWS call. Schema is loaded once and reused across entries — a 10k-row
  // batch with the per-entry parser would do 10k readFile + DOM parses.
  //
  // In strict mode we accumulate every failing entry first, then exit
  // once with the full list. The naive "exit on first failure" pattern
  // would force the caller to fix-one → re-run × N times on a batch with
  // N broken rows.
  const schema = loadProjectVariableSchema(join(projectDir, "index.html"));
  const strict = args.strictVariables ?? false;
  let hadStrictIssue = false;
  for (const { entry, lineNumber } of entries) {
    if (!entry.variables || Object.keys(entry.variables).length === 0) continue;
    const issues = validateVariablesAgainstSchema(entry.variables, schema);
    if (issues.length === 0) continue;
    if (!args.json) {
      console.log("");
      console.log(c.dim(`Batch entry on line ${lineNumber}:`));
    }
    // Pass strict: false here so the helper just prints; we own the
    // single exit-at-end below.
    reportVariableIssues(issues, { strict: false, quiet: args.json });
    if (strict) hadStrictIssue = true;
  }
  if (hadStrictIssue) {
    errorBox(
      "Variable validation failed",
      "Aborting batch due to variable issues in one or more entries (--strict-variables mode).",
    );
    process.exit(1);
  }

  const config: SerializableDistributedRenderConfig = buildLambdaBatchRenderConfig(args);

  // Deploy the site once and reuse it across every entry. --site-id and
  // --dry-run both skip the deploy via a synthesised handle.
  let siteHandle: SiteHandle;
  if (args.siteId) {
    siteHandle = makePlaceholderSiteHandle(args.siteId, stack.bucketName);
  } else if (args.dryRun) {
    siteHandle = makePlaceholderSiteHandle("dry-run-site", stack.bucketName);
  } else {
    const { deploySite } = await loadSDK();
    siteHandle = await deploySite({
      projectDir,
      bucketName: stack.bucketName,
      region: stack.region,
    });
    if (!args.json) {
      console.log(
        c.success(
          siteHandle.uploaded
            ? `Site uploaded once for the batch: ${siteHandle.siteId}`
            : `Site already up to date (skipped upload): ${siteHandle.siteId}`,
        ),
      );
      console.log();
    }
  }

  const maxConcurrent = args.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  // Skip the SDK import entirely on --dry-run; the startEntry closure
  // short-circuits before touching `renderToLambda` so it can stay
  // undefined.
  const renderToLambda = args.dryRun ? undefined : (await loadSDK()).renderToLambda;

  const startEntry = async (item: {
    entry: BatchEntry;
    lineNumber: number;
  }): Promise<BatchManifestEntry> => {
    const { entry, lineNumber } = item;
    if (args.dryRun) {
      return {
        inputLine: lineNumber,
        outputKey: entry.outputKey,
        executionArn: null,
        status: "would-invoke",
      };
    }
    if (!renderToLambda) {
      // Unreachable: dryRun returns above; this branch is for the TS
      // narrower since `renderToLambda` is undefined under dryRun.
      throw new Error("[render-batch] renderToLambda is undefined outside --dry-run");
    }
    try {
      const handle = await renderToLambda({
        siteHandle,
        bucketName: stack.bucketName,
        stateMachineArn: stack.stateMachineArn,
        region: stack.region,
        config: { ...config, variables: entry.variables },
        executionName: entry.executionName,
        outputKey: entry.outputKey,
      });
      return {
        inputLine: lineNumber,
        outputKey: entry.outputKey,
        executionArn: handle.executionArn,
        status: "started",
      };
    } catch (err) {
      return {
        inputLine: lineNumber,
        outputKey: entry.outputKey,
        executionArn: null,
        status: "failed-to-start",
        error: normalizeErrorMessage(err),
      };
    }
  };

  const manifest = await runWithConcurrencyLimit(entries, maxConcurrent, startEntry);

  if (args.json) {
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  const started = manifest.filter((m) => m.status === "started").length;
  const failed = manifest.filter((m) => m.status === "failed-to-start").length;
  const wouldInvoke = manifest.filter((m) => m.status === "would-invoke").length;

  if (args.dryRun) {
    console.log(c.success(`Dry-run complete: ${wouldInvoke} entries would invoke.`));
  } else {
    console.log(c.success(`Batch dispatched: ${started} started, ${failed} failed-to-start.`));
  }
  console.log();
  for (const row of manifest) {
    const tag =
      row.status === "started"
        ? c.success("✓")
        : row.status === "would-invoke"
          ? c.dim("·")
          : c.error("✗");
    const detail =
      row.status === "failed-to-start"
        ? c.error(row.error ?? "unknown error")
        : (row.executionArn ?? c.dim("(no execution)"));
    console.log(`  ${tag} line ${row.inputLine}  ${c.dim(row.outputKey)}  ${detail}`);
  }
  if (failed > 0) process.exitCode = 1;
}

/**
 * Synthesise a SiteHandle from a known siteId for paths that skip the
 * `deploySite` upload (`--site-id` and `--dry-run`). The SDK reads only
 * `siteId` + `projectS3Uri` when `uploaded: false`, so the byte / time
 * fields are intentional placeholders.
 */
function makePlaceholderSiteHandle(siteId: string, bucketName: string): SiteHandle {
  return {
    siteId,
    bucketName,
    projectS3Uri: `s3://${bucketName}/sites/${siteId}/project.tar.gz`,
    bytes: 0,
    uploadedAt: "",
    uploaded: false,
  };
}

/**
 * Build the shared wire {@link SerializableDistributedRenderConfig} used
 * for every entry in a `hyperframes lambda render-batch` run. Extracted for
 * boundary-test coverage of the aspect-agnostic flag threading (per-entry
 * `variables` are still overlayed at dispatch time inside {@link runRenderBatch}).
 */
export function buildLambdaBatchRenderConfig(
  args: RenderBatchArgs,
): SerializableDistributedRenderConfig {
  const config: SerializableDistributedRenderConfig = {
    fps: args.fps,
    width: args.width,
    height: args.height,
    outputResolution: args.outputResolution,
    format: args.format,
    codec: args.codec,
    quality: args.quality,
    chunkSize: args.chunkSize,
    maxParallelChunks: args.maxParallelChunks,
    targetChunkFrames: args.targetChunkFrames,
    runtimeCap: "lambda",
  };
  if (args.outputResolutionAspectAgnostic) {
    config.outputResolutionAspectAgnostic = true;
  }
  return config;
}

/**
 * Read the JSONL batch file and return one parsed entry per non-blank
 * line. Reads the whole file into memory — fine for typical batch sizes,
 * an in-memory bound the caller can size around. Calls `errorBox` and
 * `process.exit(1)` on the first malformed line so the caller doesn't
 * have to sift through thousands of rows looking for the typo.
 *
 * Exported for unit-test coverage; production callers go through
 * {@link runRenderBatch} which handles the file-not-found case.
 */
// fallow-ignore-next-line complexity
export function parseBatchFile(path: string): Array<{ entry: BatchEntry; lineNumber: number }> {
  const raw = readFileSync(path, "utf8");
  const lines = raw.split(/\r?\n/);
  const out: Array<{ entry: BatchEntry; lineNumber: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      errorBox(`Invalid JSON in batch file on line ${i + 1}`, normalizeErrorMessage(err));
      process.exit(1);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      errorBox(
        `Invalid batch entry on line ${i + 1}`,
        'Each line must be a JSON object with at least { "outputKey": "..." }.',
      );
      process.exit(1);
    }
    const obj = parsed as Record<string, unknown>;
    const outputKey = obj.outputKey;
    if (typeof outputKey !== "string" || outputKey.length === 0) {
      errorBox(
        `Missing outputKey on line ${i + 1}`,
        'Each batch entry needs a non-empty "outputKey" string (e.g. "renders/alice.mp4").',
      );
      process.exit(1);
    }
    if (obj.variables !== undefined) {
      if (
        obj.variables === null ||
        typeof obj.variables !== "object" ||
        Array.isArray(obj.variables)
      ) {
        errorBox(
          `Invalid variables on line ${i + 1}`,
          '"variables" must be a JSON object (or omitted).',
        );
        process.exit(1);
      }
    }
    if (obj.executionName !== undefined && typeof obj.executionName !== "string") {
      errorBox(
        `Invalid executionName on line ${i + 1}`,
        '"executionName" must be a string (or omitted).',
      );
      process.exit(1);
    }
    out.push({
      entry: {
        outputKey,
        variables: obj.variables as Record<string, unknown> | undefined,
        executionName: obj.executionName as string | undefined,
      },
      lineNumber: i + 1,
    });
  }
  return out;
}

/**
 * Run `worker` against every input with at most `limit` concurrent
 * invocations. Preserves input order in the returned array; each output
 * is positional with its input.
 *
 * Implementation: index-cursor + N concurrent producers each picking the
 * next index until the input is drained. Uses `Promise.all` and
 * propagates the first worker rejection — partial-failure isolation is
 * the caller's responsibility (in this file, `startEntry` wraps the
 * per-entry render in try/catch so a single failure surfaces in the
 * manifest rather than aborting the batch).
 *
 * Exported so unit tests can pin the concurrency cap independently of
 * the AWS-dependent fan-out path.
 */
export async function runWithConcurrencyLimit<T, R>(
  inputs: readonly T[],
  limit: number,
  worker: (input: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (limit < 1) throw new Error(`runWithConcurrencyLimit: limit must be ≥ 1, got ${limit}`);
  const results = new Array<R>(inputs.length);
  let cursor = 0;
  const workerCount = Math.min(limit, inputs.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < inputs.length) {
        const idx = cursor++;
        results[idx] = await worker(inputs[idx]!, idx);
      }
    }),
  );
  return results;
}
