/**
 * AWS Lambda handler for HyperFrames distributed rendering.
 *
 * One Lambda function, three roles. Step Functions dispatches by setting
 * `event.Action`; the handler unwraps Map-state envelopes, primes the
 * Lambda environment (Chrome path, ffmpeg path, tmpdir), and forwards to
 * the matching OSS primitive from `@hyperframes/producer/distributed`.
 *
 * Everything heavy — capture, encode, audio mix — happens inside the OSS
 * primitives. The handler is thin glue: parse event → S3 download → call
 * primitive → S3 upload → return small JSON result.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import {
  assemble,
  type AssembleResult,
  type ChunkResult,
  type DistributedRenderConfig,
  plan,
  type PlanResult,
  renderChunk,
} from "@hyperframes/producer/distributed";
import { resolveChromeExecutablePath } from "./chromium.js";
import { type DistributedFormat, formatExtension } from "./formatExtension.js";
import type {
  AssembleEvent,
  AssembleLambdaResult,
  LambdaAction,
  LambdaEvent,
  LambdaResult,
  PlanEvent,
  PlanLambdaResult,
  RenderChunkEvent,
  RenderChunkLambdaResult,
} from "./events.js";
import {
  downloadS3ObjectToFile,
  parseS3Uri,
  tarDirectory,
  untarDirectory,
  uploadFileToS3,
} from "./s3Transport.js";

/**
 * Lazily-constructed S3 client. Cached at module scope so warm Lambda
 * containers reuse the underlying HTTP keep-alive pool across invocations.
 */
let cachedS3Client: S3Client | null = null;
function getS3Client(): S3Client {
  if (cachedS3Client) return cachedS3Client;
  cachedS3Client = new S3Client({});
  return cachedS3Client;
}

/**
 * Optional injection points used by the handler's unit tests. Production
 * callers leave these unset; the real OSS primitives are used. Tests
 * inject `s3` and `primitives` directly rather than mutating module
 * state — the dependency-injection seam is sufficient and avoids a
 * second leak point for cross-test contamination.
 */
export interface HandlerDeps {
  s3?: S3Client;
  primitives?: {
    plan: typeof plan;
    renderChunk: typeof renderChunk;
    assemble: typeof assemble;
  };
  /** Override the per-invocation `/tmp` workdir root (defaults to Lambda's `/tmp`). */
  tmpRoot?: string;
  /** Skip Chrome resolution (used by handler dispatch tests that mock renderChunk). */
  skipChromeResolution?: boolean;
}

/**
 * Lambda entry. Step Functions sometimes wraps the event in
 * `{ Payload: ... }` or `{ Input: ... }` depending on the state machine
 * shape; unwrap until we hit a discriminated event.
 */
export async function handler(event: LambdaEvent, deps?: HandlerDeps): Promise<LambdaResult> {
  const unwrapped = unwrapEvent(event);
  validateEventS3Uris(unwrapped);
  primeRuntimeEnv();
  // Single structured boot log line — CloudWatch Logs Insights queries
  // key off `event=handler_start` to grep for a specific Action / S3 URI
  // when triaging without attaching a debugger.
  logEvent({ event: "handler_start", action: unwrapped.Action, input: summarizeEvent(unwrapped) });
  try {
    switch (unwrapped.Action) {
      case "plan":
        return await handlePlan(unwrapped, deps);
      case "renderChunk":
        return await handleRenderChunk(unwrapped, deps);
      case "assemble":
        return await handleAssemble(unwrapped, deps);
      default: {
        // Compile-time exhaustiveness: a new LambdaAction member trips
        // the `never` assignment before the runtime error is reachable.
        const _exhaustive: never = unwrapped;
        throw new Error(
          `[handler] unknown Action: ${JSON.stringify(
            (_exhaustive as { Action?: string }).Action,
          )}. Expected one of "plan", "renderChunk", "assemble".`,
        );
      }
    }
  } catch (err) {
    // Log before re-throwing so CloudWatch captures the structured
    // error context alongside Lambda's default stack trace. Otherwise
    // ops only sees the trace and has to correlate with execution
    // history to recover the action + input.
    logEvent({
      event: "handler_error",
      action: unwrapped.Action,
      message: err instanceof Error ? err.message : String(err),
      name: err instanceof Error ? err.name : undefined,
    });
    throw err;
  }
}

/**
 * Walk through Step Functions' Map-state and Task-state envelopes until
 * the discriminated event is found.
 */
// Step Functions wraps at most `{Payload: {Input: ...}}` in our state
// machine; 4 levels is 2× headroom for unusual Map / Wait state
// configurations and prevents infinite loops on malformed input.
const MAX_ENVELOPE_DEPTH = 4;

export function unwrapEvent(event: LambdaEvent): PlanEvent | RenderChunkEvent | AssembleEvent {
  let cursor: LambdaEvent = event;
  for (let i = 0; i < MAX_ENVELOPE_DEPTH; i++) {
    if (cursor && typeof cursor === "object") {
      const obj = cursor as Record<string, unknown>;
      if (typeof obj.Action === "string" && isLambdaAction(obj.Action)) {
        return cursor as PlanEvent | RenderChunkEvent | AssembleEvent;
      }
      if ("Payload" in obj) {
        cursor = obj.Payload as LambdaEvent;
        continue;
      }
      if ("Input" in obj) {
        cursor = obj.Input as LambdaEvent;
        continue;
      }
    }
    break;
  }
  throw new Error(
    `[handler] event has no recognised Action; unwrapped ${MAX_ENVELOPE_DEPTH} levels of Payload/Input without finding one.`,
  );
}

function isLambdaAction(value: string): value is LambdaAction {
  return value === "plan" || value === "renderChunk" || value === "assemble";
}

/**
 * Emit a single JSON line to stdout. CloudWatch ingests each line as a
 * structured event; Logs Insights queries can `filter event="..."` and
 * project specific fields. We write to stdout (not stderr) because
 * Lambda's default destination for both is the same log group, and
 * Logs Insights' INFO/ERROR level parser keys off the JSON `level`
 * field, not the stream.
 */
function logEvent(payload: Record<string, unknown>): void {
  console.log(JSON.stringify(payload));
}

/**
 * Compact, non-PII summary of a Lambda event for logging. The full
 * event payload can include the entire project config; we only emit
 * the routable fields (S3 URIs, chunk index, format) needed to triage
 * a failure from CloudWatch.
 */
function summarizeEvent(
  event: PlanEvent | RenderChunkEvent | AssembleEvent,
): Record<string, unknown> {
  switch (event.Action) {
    case "plan":
      return {
        projectS3Uri: event.ProjectS3Uri,
        planOutputS3Prefix: event.PlanOutputS3Prefix,
        format: event.Config.format,
        fps: event.Config.fps,
      };
    case "renderChunk":
      return {
        planS3Uri: event.PlanS3Uri,
        chunkIndex: event.ChunkIndex,
        format: event.Format,
      };
    case "assemble":
      return {
        planS3Uri: event.PlanS3Uri,
        chunkCount: event.ChunkS3Uris.length,
        hasAudio: event.AudioS3Uri !== null,
        outputS3Uri: event.OutputS3Uri,
        format: event.Format,
      };
  }
}

/**
 * Lambda sets `TMPDIR` to `/tmp` already, but the bundled binaries (Chrome
 * + ffmpeg) live alongside the handler at `/var/task/bin/`. Add that to
 * PATH the first time the handler runs so spawn("ffmpeg", …) inside the
 * OSS primitives resolves to the bundled binary.
 */
let runtimeEnvPrimed = false;
function primeRuntimeEnv(): void {
  if (runtimeEnvPrimed) return;
  runtimeEnvPrimed = true;
  const taskRoot = process.env.LAMBDA_TASK_ROOT ?? "/var/task";
  const bin = join(taskRoot, "bin");
  if (existsSync(bin)) {
    process.env.PATH = `${bin}:${process.env.PATH ?? ""}`;
  }
}

// ── Plan ────────────────────────────────────────────────────────────────────

async function handlePlan(event: PlanEvent, deps?: HandlerDeps): Promise<PlanLambdaResult> {
  const started = Date.now();
  const s3 = deps?.s3 ?? getS3Client();
  const primitive = deps?.primitives?.plan ?? plan;

  // The producer's probe stage launches Chromium whenever the composition
  // needs a runtime duration probe or has unresolved sub-compositions, so
  // plan has to resolve Chrome the same way renderChunk does. Without this
  // the probe throws "An `executablePath` or `channel` must be specified
  // for `puppeteer-core`" the moment runProbeStage calls puppeteer.launch.
  if (!deps?.skipChromeResolution && !process.env.PRODUCER_HEADLESS_SHELL_PATH) {
    const chromePath = await resolveChromeExecutablePath();
    process.env.PRODUCER_HEADLESS_SHELL_PATH = chromePath;
  }

  const work = mkdtempSync(join(deps?.tmpRoot ?? tmpdir(), "hf-lambda-plan-"));
  // We use `.tar.gz` (not `.zip`) as the project archive's on-the-wire
  // format because Lambda's Amazon Linux base image ships GNU `tar` but
  // not `unzip` in `/usr/bin`. The smoke script + future CLI both
  // produce tar.gz uploads.
  const projectArchive = join(work, "project.tar.gz");
  const projectDir = join(work, "project");
  const planDir = join(work, "plan");

  try {
    await downloadS3ObjectToFile(s3, event.ProjectS3Uri, projectArchive);
    await untarDirectory(projectArchive, projectDir);

    const config: DistributedRenderConfig = {
      ...event.Config,
    };
    const result: PlanResult = await primitive(projectDir, config, planDir);

    // Upload the planDir as a single tarball. Step Functions cannot pass
    // a directory-shaped artifact between states; we serialize and rely on
    // the consumer (renderChunk / assemble) to untar. Audio is co-located
    // alongside the plan so RenderChunk doesn't have to pull the whole
    // plan tarball when audio isn't relevant to the chunk.
    const planTar = join(work, "plan.tar.gz");
    await tarDirectory(planDir, planTar);
    const planTarUri = `${trimTrailingSlash(event.PlanOutputS3Prefix)}/plan.tar.gz`;
    const audioPath = join(planDir, "audio.aac");
    const hasAudio = existsSync(audioPath) && statSync(audioPath).size > 0;
    const audioUri = hasAudio ? `${trimTrailingSlash(event.PlanOutputS3Prefix)}/audio.aac` : null;
    // Plan and audio are independent S3 PUTs; run them in parallel so
    // the response returns as soon as the slower of the two completes.
    await Promise.all([
      uploadFileToS3(s3, planTar, planTarUri, "application/gzip"),
      hasAudio && audioUri ? uploadFileToS3(s3, audioPath, audioUri, "audio/aac") : null,
    ]);

    return {
      Action: "plan",
      PlanS3Uri: planTarUri,
      PlanHash: result.planHash,
      ChunkCount: result.chunkCount,
      TotalFrames: result.totalFrames,
      Fps: result.fps,
      Width: result.width,
      Height: result.height,
      Format: result.format,
      HasAudio: audioUri !== null,
      AudioS3Uri: audioUri,
      FfmpegVersion: result.ffmpegVersion,
      ProducerVersion: result.producerVersion,
      DurationMs: Date.now() - started,
    };
  } finally {
    cleanupDir(work);
  }
}

// ── RenderChunk ─────────────────────────────────────────────────────────────

async function handleRenderChunk(
  event: RenderChunkEvent,
  deps?: HandlerDeps,
): Promise<RenderChunkLambdaResult> {
  const started = Date.now();
  const s3 = deps?.s3 ?? getS3Client();
  const primitive = deps?.primitives?.renderChunk ?? renderChunk;

  // Sparticuz decompresses Chromium into /tmp on first call; warm starts
  // skip the work (path already cached). Guard the env-var mutation too so
  // a caller-supplied PRODUCER_HEADLESS_SHELL_PATH (e.g. the SAM-local
  // RIE smoke) wins over the auto-resolution.
  if (!deps?.skipChromeResolution && !process.env.PRODUCER_HEADLESS_SHELL_PATH) {
    const chromePath = await resolveChromeExecutablePath();
    // The OSS engine resolves Chrome via `PRODUCER_HEADLESS_SHELL_PATH`
    // first (see `browserManager.resolveHeadlessShellPath`); set it before
    // invoking the primitive so launch picks up the bundled binary.
    process.env.PRODUCER_HEADLESS_SHELL_PATH = chromePath;
  }

  const work = mkdtempSync(join(deps?.tmpRoot ?? tmpdir(), "hf-lambda-chunk-"));
  const planTar = join(work, "plan.tar.gz");
  const planDir = join(work, "plan");

  try {
    await downloadS3ObjectToFile(s3, event.PlanS3Uri, planTar);
    await untarDirectory(planTar, planDir);

    // Verify the plan's hash matches what Step Functions told us to render.
    // The producer's renderChunk re-checks internally (defense-in-depth),
    // but doing it here at the handler boundary lets us fail before paying
    // the Chrome-launch + render cost on a misrouted chunk. Throws a
    // typed PLAN_HASH_MISMATCH that Step Functions can route as
    // non-retryable.
    verifyPlanHash(planDir, event.PlanHash);

    const chunkOutputBase = join(
      work,
      event.Format === "png-sequence"
        ? `chunk-${pad(event.ChunkIndex)}`
        : `chunk-${pad(event.ChunkIndex)}${formatExtension(event.Format)}`,
    );

    const result: ChunkResult = await primitive(planDir, event.ChunkIndex, chunkOutputBase);

    const chunkUri = await uploadChunkOutput(
      s3,
      result,
      event.ChunkOutputS3Prefix,
      event.ChunkIndex,
    );

    return {
      Action: "renderChunk",
      ChunkS3Uri: chunkUri,
      ChunkIndex: event.ChunkIndex,
      Sha256: result.sha256,
      FramesEncoded: result.framesEncoded,
      DurationMs: Date.now() - started,
    };
  } finally {
    cleanupDir(work);
  }
}

async function uploadChunkOutput(
  s3: S3Client,
  result: ChunkResult,
  prefix: string,
  chunkIndex: number,
): Promise<string> {
  const trimmed = trimTrailingSlash(prefix);
  if (result.outputKind === "file") {
    const ext = result.outputPath.slice(result.outputPath.lastIndexOf("."));
    const uri = `${trimmed}/chunks/${pad(chunkIndex)}${ext}`;
    await uploadFileToS3(s3, result.outputPath, uri);
    return uri;
  }
  // frame-dir: upload as a tarball so a single S3 object represents the chunk.
  // Assemble's png-sequence path expects a directory per chunk; it untars on
  // its end.
  const tarball = `${result.outputPath}.tar.gz`;
  await tarDirectory(result.outputPath, tarball);
  const uri = `${trimmed}/chunks/${pad(chunkIndex)}.tar.gz`;
  await uploadFileToS3(s3, tarball, uri, "application/gzip");
  return uri;
}

// ── Assemble ────────────────────────────────────────────────────────────────

async function handleAssemble(
  event: AssembleEvent,
  deps?: HandlerDeps,
): Promise<AssembleLambdaResult> {
  const started = Date.now();
  const s3 = deps?.s3 ?? getS3Client();
  const primitive = deps?.primitives?.assemble ?? assemble;

  const work = mkdtempSync(join(deps?.tmpRoot ?? tmpdir(), "hf-lambda-assemble-"));
  const planTar = join(work, "plan.tar.gz");
  const planDir = join(work, "plan");

  try {
    await downloadS3ObjectToFile(s3, event.PlanS3Uri, planTar);
    await untarDirectory(planTar, planDir);

    const chunkPaths = await downloadChunkObjects(s3, event.ChunkS3Uris, work, event.Format);

    let audioPath: string | null = null;
    if (event.AudioS3Uri) {
      audioPath = join(planDir, "audio.aac");
      await downloadS3ObjectToFile(s3, event.AudioS3Uri, audioPath);
    }

    const finalOutput =
      event.Format === "png-sequence"
        ? join(work, "output-frames")
        : join(work, `output${formatExtension(event.Format)}`);

    const result: AssembleResult = await primitive(planDir, chunkPaths, audioPath, finalOutput, {
      cfr: event.Cfr === true,
    });

    if (event.Format === "png-sequence") {
      const tarball = `${finalOutput}.tar.gz`;
      await tarDirectory(finalOutput, tarball);
      await uploadFileToS3(s3, tarball, event.OutputS3Uri, "application/gzip");
    } else {
      await uploadFileToS3(s3, finalOutput, event.OutputS3Uri);
    }

    return {
      Action: "assemble",
      OutputS3Uri: event.OutputS3Uri,
      FramesEncoded: result.framesEncoded,
      FileSize: result.fileSize,
      DurationMs: Date.now() - started,
    };
  } finally {
    cleanupDir(work);
  }
}

async function downloadChunkObjects(
  s3: S3Client,
  uris: string[],
  workDir: string,
  format: DistributedFormat,
): Promise<string[]> {
  const chunksDir = join(workDir, "chunks");
  mkdirSync(chunksDir, { recursive: true });
  // Each chunk is an independent S3 GET (+ untar for png-sequence). Run
  // them in parallel — assemble's wall-clock is otherwise dominated by
  // `Σ chunk-download-ms` instead of `max(chunk-download-ms)`. Preserve
  // the input order by writing into a pre-sized array rather than
  // pushing as each task settles.
  const local: string[] = new Array<string>(uris.length);
  await Promise.all(
    uris.map(async (uri, i) => {
      if (!uri) {
        throw new Error(`[handler] chunk URI at index ${i} is empty`);
      }
      const { key } = parseS3Uri(uri);
      const localPath = join(chunksDir, basename(key));
      await downloadS3ObjectToFile(s3, uri, localPath);
      if (format === "png-sequence") {
        const dirPath = join(chunksDir, `frames-${pad(i)}`);
        await untarDirectory(localPath, dirPath);
        local[i] = dirPath;
      } else {
        local[i] = localPath;
      }
    }),
  );
  return local;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Collect every S3 URI that the handler will touch for a given event. */
function getEventS3Uris(event: PlanEvent | RenderChunkEvent | AssembleEvent): string[] {
  switch (event.Action) {
    case "plan":
      return [event.ProjectS3Uri, event.PlanOutputS3Prefix];
    case "renderChunk":
      return [event.PlanS3Uri, event.ChunkOutputS3Prefix];
    case "assemble":
      return [event.PlanS3Uri, ...event.ChunkS3Uris, event.OutputS3Uri, event.AudioS3Uri].filter(
        (u): u is string => u != null,
      );
  }
}

/**
 * Verify every S3 URI in the event resolves to the configured render bucket.
 * Throws `S3_URI_NOT_ALLOWED` (non-retryable) when a URI targets a different
 * bucket, preventing event injection from reading or writing arbitrary S3 data.
 *
 * Skipped when `HYPERFRAMES_RENDER_BUCKET` is unset so existing deployments
 * without the env var continue to work.
 */
function validateEventS3Uris(event: PlanEvent | RenderChunkEvent | AssembleEvent): void {
  const allowedBucket = process.env.HYPERFRAMES_RENDER_BUCKET?.trim();
  if (!allowedBucket) return;

  for (const uri of getEventS3Uris(event)) {
    const { bucket } = parseS3Uri(uri);
    if (bucket !== allowedBucket) {
      const err = new Error(
        `[handler] S3_URI_NOT_ALLOWED: URI ${JSON.stringify(uri)} targets bucket "${bucket}" but only "${allowedBucket}" is permitted`,
      );
      err.name = "S3_URI_NOT_ALLOWED";
      throw err;
    }
  }
}

function pad(n: number): string {
  return n.toString().padStart(4, "0");
}

function trimTrailingSlash(prefix: string): string {
  return prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
}

function cleanupDir(dir: string): void {
  try {
    // Lambda warm starts can reuse `/tmp` across invocations; clean up
    // aggressively so we don't leak a chunk-sized footprint between renders.
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best-effort — leak is preferable to crashing on success path.
  }
}

/**
 * Read the untarred planDir's `plan.json` and assert its `planHash`
 * matches what the Step Functions event claims. Throws on mismatch with
 * a typed `PLAN_HASH_MISMATCH` error name so the state machine's typed
 * non-retryable list routes it correctly.
 *
 * This is defense-in-depth — the producer's `renderChunk` does the same
 * check internally — but performing it here lets us fail before paying
 * the Chrome-launch + per-frame capture cost on a misrouted chunk.
 */
function verifyPlanHash(planDir: string, expected: string): void {
  const planJsonPath = join(planDir, "plan.json");
  let parsed: { planHash?: unknown };
  try {
    parsed = JSON.parse(readFileSync(planJsonPath, "utf-8")) as { planHash?: unknown };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const error = new Error(`PLAN_HASH_MISMATCH: failed to read ${planJsonPath}: ${msg}`);
    error.name = "PLAN_HASH_MISMATCH";
    throw error;
  }
  const actual = parsed.planHash;
  if (typeof actual !== "string" || actual !== expected) {
    const error = new Error(
      `PLAN_HASH_MISMATCH: event PlanHash=${expected} did not match plan.json planHash=${String(actual)}`,
    );
    error.name = "PLAN_HASH_MISMATCH";
    throw error;
  }
}
