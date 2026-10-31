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
import { availableParallelism, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { GetAccountSettingsCommand, InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import {
  assemble,
  buildPlanAudio,
  chunksAreStitchedMp4,
  plansSeparateAudio,
  stitchesSeparateAudio,
  type AssembleResult,
  type ChunkRenderer,
  type ChunkResult,
  type DistributedRenderConfig,
  DEFAULT_MAX_PARALLEL_CHUNKS,
  listPlanV2ArtifactsForTarget,
  materializePlanV2Target,
  plan,
  isPlanAudioArtifactPath,
  PLAN_AUDIO_RELATIVE_PATH,
  resolvePlanAudioPath,
  planV2WithPublisher,
  type PlanResult,
  isPlanV2DeferredSourceArtifact,
  type PlanV2Artifact,
  type PlanV2Manifest,
  type PlanV2MaterializationTarget,
  readPlanV2Manifest,
  type RemoteProjectFile,
  renderChunk,
} from "@hyperframes/producer/distributed";
import { resolveChromeExecutablePath } from "./chromium.js";
import { type StitchHelper, sendRangeParts, stitchMp4InS3 } from "./s3Stitch.js";
import { type DistributedFormat, formatExtension } from "./formatExtension.js";
import type {
  AssembleEvent,
  AssembleLambdaResult,
  AudioEvent,
  AudioLambdaResult,
  LambdaAction,
  LambdaEvent,
  LambdaResult,
  PlanEvent,
  PlanV2Event,
  PlanLambdaResult,
  RenderChunkEvent,
  RenderChunkV2Event,
  RenderChunkLambdaResult,
  AssembleV2Event,
  StitchPartsEvent,
  StitchPartsLambdaResult,
} from "./events.js";
import {
  downloadS3ObjectToFile,
  downloadS3ObjectToFileVerified,
  mapConcurrent,
  parseS3Uri,
  presignVerifiedS3GetUrl,
  tarDirectory,
  untarDirectory,
  uploadFileToS3,
} from "./s3Transport.js";
import { S3PlanV2ArtifactPublisher } from "./s3PlanV2Publisher.js";
import { downloadSiteFiles, isSiteManifestUri } from "./siteManifest.js";

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
  /** Reads the account's concurrency when the render does not set one. */
  lambda?: LambdaClient;
  primitives?: {
    plan: typeof plan;
    planV2WithPublisher?: typeof planV2WithPublisher;
    buildPlanAudio?: typeof buildPlanAudio;
    renderChunk: ChunkRenderer;
    assemble: typeof assemble;
  };
  /** Override the per-invocation `/tmp` workdir root (defaults to Lambda's `/tmp`). */
  tmpRoot?: string;
  /** Skip Chrome resolution (used by handler dispatch tests that mock renderChunk). */
  skipChromeResolution?: boolean;
  /**
   * The Lambda runtime's `Context` arrives as this second argument and supplies it. Plan
   * and chunk share one function, so its remaining time at plan start is the chunk limit.
   */
  getRemainingTimeInMillis?: () => number;
}

/**
 * Lambda entry. Step Functions sometimes wraps the event in
 * `{ Payload: ... }` or `{ Input: ... }` depending on the state machine
 * shape; unwrap until we hit a discriminated event.
 */
export async function handler(event: LambdaEvent, deps?: HandlerDeps): Promise<LambdaResult> {
  if ((event as { Action?: unknown }).Action === "warm") {
    primeRuntimeEnv();
    await ensureChromePath(deps);
    return { Action: "warm" };
  }
  if ((event as { Action?: unknown }).Action === "stitchParts") {
    return await handleStitchParts(event as StitchPartsEvent, deps);
  }
  const unwrapped = unwrapEvent(event);
  validatePlanProtocolShape(unwrapped);
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
      case "audio":
        return await handleAudio(unwrapped, deps);
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
    normalizeTerminalErrorName(err);
    // Log before re-throwing so CloudWatch captures the structured
    // error context alongside Lambda's default stack trace. Otherwise
    // ops only sees the trace and has to correlate with execution
    // history to recover the action + input.
    logEvent({
      event: "handler_error",
      action: unwrapped.Action,
      input: summarizeEvent(unwrapped),
      message: err instanceof Error ? err.message : String(err),
      name: err instanceof Error ? err.name : undefined,
    });
    throw err;
  }
}

/**
 * AWS Lambda reports `Error.name` to Step Functions, while producer errors
 * expose stable machine codes separately. Normalize workflow-facing codes
 * whose historical class names differ from their orchestration contracts.
 */
// The explicit error-name mapping is the public Step Functions failure contract.
// fallow-ignore-next-line complexity
function normalizeTerminalErrorName(error: unknown): void {
  if (!error || typeof error !== "object") return;
  const candidate = error as { code?: unknown; name?: string };
  if (
    candidate.code === "PLAN_PROTOCOL_UNSUPPORTED" ||
    candidate.code === "PLAN_TOO_LARGE" ||
    candidate.code === "PLAN_V2_INTEGRITY_UNRECOVERABLE" ||
    candidate.code === "FONT_FETCH_FAILED" ||
    candidate.code === "FONT_FETCH_UNAVAILABLE" ||
    candidate.code === "NOT_MEDIA_PAYLOAD" ||
    candidate.code === "VIDEO_SOURCE_UNRENDERABLE" ||
    candidate.code === "VIDEO_EXTRACTION_FAILED" ||
    candidate.code === "INVALID_VIDEO_METADATA" ||
    candidate.code === "FORMAT_NOT_SUPPORTED_IN_DISTRIBUTED" ||
    candidate.code === "CHUNK_EXCEEDS_WORKER_TIMEOUT"
  ) {
    candidate.name = candidate.code;
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

export function unwrapEvent(
  event: LambdaEvent,
): PlanEvent | AudioEvent | RenderChunkEvent | AssembleEvent {
  let cursor: LambdaEvent = event;
  for (let i = 0; i < MAX_ENVELOPE_DEPTH; i++) {
    if (cursor && typeof cursor === "object") {
      const obj = cursor as Record<string, unknown>;
      if (typeof obj.Action === "string" && isLambdaAction(obj.Action)) {
        return cursor as PlanEvent | AudioEvent | RenderChunkEvent | AssembleEvent;
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
  return value === "plan" || value === "audio" || value === "renderChunk" || value === "assemble";
}

// This is the single fail-closed boundary for the wire union. Keeping all
// forbidden locator combinations together makes mixed-protocol input auditable.
// fallow-ignore-next-line complexity
function validatePlanProtocolShape(
  event: PlanEvent | AudioEvent | RenderChunkEvent | AssembleEvent,
): void {
  const raw = event as unknown as Record<string, unknown>;
  const protocol = raw.PlanProtocol;
  if (protocol !== undefined && protocol !== "v1" && protocol !== "v2") {
    const error = new Error(
      `[handler] unsupported PlanProtocol ${JSON.stringify(protocol)}; expected "v1", "v2", or absent`,
    );
    error.name = "PLAN_PROTOCOL_UNSUPPORTED";
    throw error;
  }
  if (event.Action === "plan" || event.Action === "audio") return;

  const effectiveProtocol = protocol ?? "v2";
  const hasV1Locator = typeof raw.PlanS3Uri === "string";
  const hasV2Manifest = typeof raw.PlanV2ManifestS3Uri === "string";
  const hasV2Prefix = typeof raw.PlanV2ArtifactS3Prefix === "string";
  const valid =
    effectiveProtocol === "v2"
      ? !hasV1Locator && hasV2Manifest && hasV2Prefix
      : hasV1Locator && !hasV2Manifest && !hasV2Prefix;
  if (!valid) {
    const error = new Error(
      `[handler] ${effectiveProtocol} ${event.Action} event has mixed or missing plan locators`,
    );
    error.name = "PLAN_PROTOCOL_UNSUPPORTED";
    throw error;
  }
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
// Keep event variants together so logs share one redaction and summarization boundary.
// fallow-ignore-next-line complexity
function summarizeEvent(
  event: PlanEvent | AudioEvent | RenderChunkEvent | AssembleEvent,
): Record<string, unknown> {
  switch (event.Action) {
    case "plan":
      return {
        projectS3Uri: event.ProjectS3Uri,
        planOutputS3Prefix: event.PlanOutputS3Prefix,
        planProtocol: event.PlanProtocol ?? "v2",
        format: event.Config.format,
        fps: event.Config.fps,
      };
    case "audio":
      return {
        projectS3Uri: event.ProjectS3Uri,
        planOutputS3Prefix: event.PlanOutputS3Prefix,
        format: event.Config.format,
        fps: event.Config.fps,
      };
    case "renderChunk":
      return {
        planProtocol: event.PlanProtocol ?? "v2",
        ...(event.PlanProtocol !== "v1"
          ? { planV2ManifestS3Uri: event.PlanV2ManifestS3Uri }
          : { planS3Uri: event.PlanS3Uri }),
        chunkIndex: event.ChunkIndex,
        format: event.Format,
      };
    case "assemble":
      return {
        planProtocol: event.PlanProtocol ?? "v2",
        ...(event.PlanProtocol !== "v1"
          ? { planV2ManifestS3Uri: event.PlanV2ManifestS3Uri }
          : { planS3Uri: event.PlanS3Uri }),
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

// Share of the account's unreserved concurrency a render plans for. The rest stays free for other
// functions; at the default 1000 quota that is the 100 AWS keeps unreserved anyway.
const ACCOUNT_CONCURRENCY_SHARE = 0.9;

async function resolveWorkerConcurrency(event: PlanEvent, deps?: HandlerDeps): Promise<number> {
  if (event.Config.workerConcurrency !== undefined) return event.Config.workerConcurrency;
  try {
    return await functionConcurrency(deps?.lambda);
  } catch (err) {
    logEvent({
      event: "worker_concurrency",
      level: "WARN",
      source: "fallback",
      concurrency: DEFAULT_MAX_PARALLEL_CHUNKS,
      message:
        `Could not read the account's Lambda concurrency (${String(err)}); ` +
        `planning for ${DEFAULT_MAX_PARALLEL_CHUNKS} chunks at once. Allow lambda:GetAccountSettings ` +
        "on the function role, or set the concurrency explicitly.",
    });
    return DEFAULT_MAX_PARALLEL_CHUNKS;
  }
}

/** The stack's reserved concurrency (on the function that runs the chunks), if it sets one. */
function reservedConcurrency(): number | undefined {
  const reserved = Number(process.env.HYPERFRAMES_LAMBDA_RESERVED_CONCURRENCY);
  return reserved > 0 ? reserved : undefined;
}

/** The function's reserved concurrency, else its share of the account's unreserved pool. */
async function functionConcurrency(lambda = new LambdaClient({})): Promise<number> {
  const reserved = reservedConcurrency();
  if (reserved) return reserved;
  const { AccountLimit } = await lambda.send(new GetAccountSettingsCommand({}));
  const unreserved = AccountLimit?.UnreservedConcurrentExecutions;
  if (unreserved === undefined) throw new Error("no UnreservedConcurrentExecutions in the reply");
  const concurrency = Math.max(1, Math.floor(unreserved * ACCOUNT_CONCURRENCY_SHARE));
  logEvent({ event: "worker_concurrency", source: "account", unreserved, concurrency });
  return concurrency;
}

async function planConfig(
  event: PlanEvent,
  deps?: HandlerDeps,
): Promise<DistributedRenderConfig & { workerConcurrency: number }> {
  const config = {
    ...event.Config,
    workerConcurrency: await resolveWorkerConcurrency(event, deps),
  };
  const remainingMs = deps?.getRemainingTimeInMillis?.();
  if (config.workerTimeoutSeconds === undefined && remainingMs !== undefined) {
    config.workerTimeoutSeconds = Math.ceil(remainingMs / 1000);
  }
  return config;
}

// The v1 handler owns one transactional download, plan, archive, upload, and cleanup lifecycle.
// fallow-ignore-next-line complexity
async function handlePlan(event: PlanEvent, deps?: HandlerDeps): Promise<PlanLambdaResult> {
  if (event.PlanProtocol !== "v1") {
    return handlePlanV2(event, deps);
  }
  const started = Date.now();
  const config = await planConfig(event, deps);
  const s3 = deps?.s3 ?? getS3Client();
  const primitive = deps?.primitives?.plan ?? plan;
  await ensureChromePath(deps);

  const work = mkdtempSync(join(deps?.tmpRoot ?? tmpdir(), "hf-lambda-plan-"));
  const planDir = join(work, "plan");

  try {
    const { projectDir } = await fetchProject(s3, event.ProjectS3Uri, work);

    // Same chunk layout as v2, so both protocols produce the same chunks and output.
    const result: PlanResult = await primitive(projectDir, config, planDir, {
      chunksCarryAudio: true,
    });

    // Upload the planDir as a single tarball. Step Functions cannot pass
    // a directory-shaped artifact between states; we serialize and rely on
    // the consumer (renderChunk / assemble) to untar. Audio is co-located
    // alongside the plan so RenderChunk doesn't have to pull the whole
    // plan tarball when audio isn't relevant to the chunk.
    const planTar = join(work, "plan.tar.gz");
    await tarDirectory(planDir, planTar);
    const planTarUri = `${trimTrailingSlash(event.PlanOutputS3Prefix)}/plan.tar.gz`;
    const audioPath = join(planDir, PLAN_AUDIO_RELATIVE_PATH);
    const hasAudio = existsSync(audioPath) && statSync(audioPath).size > 0;
    const audioUri = hasAudio
      ? `${trimTrailingSlash(event.PlanOutputS3Prefix)}/${PLAN_AUDIO_RELATIVE_PATH}`
      : null;
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
      MaxChunkConcurrency: Math.min(config.workerConcurrency, result.chunkCount),
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

/**
 * `ProjectS3Uri` is a site manifest from `deploySite`, or a `.tar.gz` of the project
 * (hand-built uploads such as `examples/aws-lambda/scripts/smoke.sh`).
 */
async function fetchProject(
  s3: S3Client,
  projectS3Uri: string,
  work: string,
  leaveVideosRemote = false,
): Promise<{ projectDir: string; remoteFiles: Record<string, RemoteProjectFile> }> {
  const projectDir = join(work, "project");
  if (isSiteManifestUri(projectS3Uri)) {
    const remoteFiles = await downloadSiteFiles(s3, projectS3Uri, projectDir, leaveVideosRemote);
    return { projectDir, remoteFiles };
  }
  const projectArchive = join(work, "project.tar.gz");
  let stageStarted = Date.now();
  await downloadS3ObjectToFile(s3, projectS3Uri, projectArchive);
  logEvent({ event: "plan_stage", stage: "download", ms: Date.now() - stageStarted });
  stageStarted = Date.now();
  await untarDirectory(projectArchive, projectDir);
  logEvent({ event: "plan_stage", stage: "untar", ms: Date.now() - stageStarted });
  return { projectDir, remoteFiles: {} };
}

// Plan v2 orchestration is kept as one transactional boundary: stage, CAS upload,
// and manifest-last publication must stay ordered and fail together.
// fallow-ignore-next-line complexity
async function handlePlanV2(
  event: PlanV2Event,
  deps?: HandlerDeps,
): Promise<Extract<PlanLambdaResult, { PlanProtocol: "v2" }>> {
  const started = Date.now();
  const config = await planConfig(event, deps);
  const s3 = deps?.s3 ?? getS3Client();
  const primitive = deps?.primitives?.planV2WithPublisher ?? planV2WithPublisher;
  await ensureChromePath(deps);

  const work = mkdtempSync(join(deps?.tmpRoot ?? tmpdir(), "hf-lambda-plan-v2-"));
  try {
    const { projectDir, remoteFiles } = await fetchProject(s3, event.ProjectS3Uri, work, true);
    const publisher = new S3PlanV2ArtifactPublisher({
      s3,
      planOutputS3Prefix: event.PlanOutputS3Prefix,
      temporaryRoot: work,
    });
    // The audio task shares the chunks' workers: it runs beside them only with one kept free.
    const separateAudio =
      config.workerConcurrency > 1 && plansSeparateAudio(config, { deferAudio: true });
    const manifest: PlanV2Manifest = await primitive(projectDir, config, publisher, {
      stagingParentDir: work,
      remoteFiles,
      chunksCarryAudio: true,
      deferAudio: separateAudio,
    });

    return {
      Action: "plan",
      PlanProtocol: "v2",
      PlanV2ManifestS3Uri: publisher.manifestUri,
      PlanV2ArtifactS3Prefix: publisher.artifactPrefix,
      PlanHash: manifest.planHash,
      ChunkCount: manifest.chunkCount,
      MaxChunkConcurrency: Math.min(
        config.workerConcurrency - (separateAudio ? 1 : 0),
        manifest.chunkCount,
      ),
      TotalFrames: manifest.totalFrames,
      Fps: manifest.fps,
      Width: manifest.width,
      Height: manifest.height,
      Format: manifest.format,
      HasAudio: manifest.artifacts.some((artifact) => isPlanAudioArtifactPath(artifact.path)),
      AudioS3Uri: null,
      SeparateAudio: separateAudio,
      FfmpegVersion: manifest.ffmpegVersion,
      ProducerVersion: manifest.producerVersion,
      DurationMs: Date.now() - started,
    };
  } finally {
    cleanupDir(work);
  }
}

/**
 * Points the engine at the bundled Chrome (unpacked into /tmp once per container) before any stage
 * launches it; a caller-set PRODUCER_HEADLESS_SHELL_PATH, such as the SAM-local smoke's, wins.
 */
async function ensureChromePath(deps?: HandlerDeps): Promise<void> {
  if (deps?.skipChromeResolution || process.env.PRODUCER_HEADLESS_SHELL_PATH) return;
  process.env.PRODUCER_HEADLESS_SHELL_PATH = await resolveChromeExecutablePath();
}

// ── Audio ───────────────────────────────────────────────────────────────────

async function handleAudio(event: AudioEvent, deps?: HandlerDeps): Promise<AudioLambdaResult> {
  const started = Date.now();
  const none = (): AudioLambdaResult => ({
    Action: "audio",
    HasAudio: false,
    AudioS3Uri: null,
    DurationMs: Date.now() - started,
  });
  // The plan mixed it (png-sequence, cfr): the assembler reads it from the manifest.
  if (!plansSeparateAudio(event.Config, { deferAudio: true })) return none();
  const s3 = deps?.s3 ?? getS3Client();
  await ensureChromePath(deps);
  const work = mkdtempSync(join(deps?.tmpRoot ?? tmpdir(), "hf-lambda-audio-"));
  try {
    const { projectDir, remoteFiles } = await fetchProject(s3, event.ProjectS3Uri, work, true);
    const audioPath = join(work, "audio.m4a");
    const build = deps?.primitives?.buildPlanAudio ?? buildPlanAudio;
    const { hasAudio } = await build(projectDir, event.Config, join(work, "plan"), audioPath, {
      remoteFiles,
    });
    if (!hasAudio) return none();
    const audioUri = `${trimTrailingSlash(event.PlanOutputS3Prefix)}/audio/${PLAN_AUDIO_RELATIVE_PATH}`;
    await uploadFileToS3(s3, audioPath, audioUri, "audio/mp4");
    return {
      Action: "audio",
      HasAudio: true,
      AudioS3Uri: audioUri,
      DurationMs: Date.now() - started,
    };
  } finally {
    cleanupDir(work);
  }
}

// ── RenderChunk ─────────────────────────────────────────────────────────────

// Twice a 4K capture browser's peak memory, so half the function stays free.
const LAMBDA_MB_PER_CAPTURE_BROWSER = 2048;

/** Capture browsers this function can host: by its memory, leaving one core to Node and ffmpeg. */
function lambdaMaxCaptureWorkers(): number | undefined {
  const memoryMb = Number(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE);
  if (!(memoryMb > 0)) return undefined;
  const byMemory = Math.floor(memoryMb / LAMBDA_MB_PER_CAPTURE_BROWSER);
  return Math.max(1, Math.min(byMemory, availableParallelism() - 1));
}

async function handleRenderChunk(
  event: RenderChunkEvent,
  deps?: HandlerDeps,
): Promise<RenderChunkLambdaResult> {
  if (event.PlanProtocol !== "v1") {
    return handleRenderChunkV2(event, deps);
  }
  const started = Date.now();
  const s3 = deps?.s3 ?? getS3Client();
  const primitive = deps?.primitives?.renderChunk ?? renderChunk;
  const chromeStarted = Date.now();
  await ensureChromePath(deps);
  const chromeMs = Date.now() - chromeStarted;

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

    const primitiveStarted = Date.now();
    const result: ChunkResult = await primitive(planDir, event.ChunkIndex, chunkOutputBase, {
      maxCaptureWorkers: lambdaMaxCaptureWorkers(),
      interleaveCapture: true,
    });
    logEvent({
      event: "chunk_capture",
      chunkIndex: event.ChunkIndex,
      workers: result.workers,
      captureMode: result.captureMode,
      ...chunkStageTimings(result, primitiveStarted - started, chromeMs),
    });

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
      CaptureMode: result.captureMode,
      DurationMs: Date.now() - started,
    };
  } finally {
    cleanupDir(work);
  }
}

// The v2 chunk handler deliberately keeps download, verified materialization,
// render, and upload in one lifecycle so cleanup and errors remain atomic.
// fallow-ignore-next-line complexity
async function handleRenderChunkV2(
  event: RenderChunkV2Event,
  deps?: HandlerDeps,
): Promise<RenderChunkLambdaResult> {
  const started = Date.now();
  const s3 = deps?.s3 ?? getS3Client();
  const primitive = deps?.primitives?.renderChunk ?? renderChunk;
  const chromeStarted = Date.now();
  await ensureChromePath(deps);
  const chromeMs = Date.now() - chromeStarted;
  const work = mkdtempSync(join(deps?.tmpRoot ?? tmpdir(), "hf-lambda-chunk-v2-"));
  try {
    const { planDir } = await downloadAndMaterializePlanV2(
      s3,
      event,
      { role: "chunk", chunkIndex: event.ChunkIndex },
      work,
    );
    const chunkOutputBase = join(
      work,
      event.Format === "png-sequence"
        ? `chunk-${pad(event.ChunkIndex)}`
        : `chunk-${pad(event.ChunkIndex)}${formatExtension(event.Format)}`,
    );
    const primitiveStarted = Date.now();
    const result = await primitive(planDir, event.ChunkIndex, chunkOutputBase, {
      maxCaptureWorkers: lambdaMaxCaptureWorkers(),
      interleaveCapture: true,
    });
    logEvent({
      event: "chunk_capture",
      chunkIndex: event.ChunkIndex,
      workers: result.workers,
      captureMode: result.captureMode,
      ...chunkStageTimings(result, primitiveStarted - started, chromeMs),
    });
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
      CaptureMode: result.captureMode,
      DurationMs: Date.now() - started,
    };
  } finally {
    cleanupDir(work);
  }
}

function chunkStageTimings(result: ChunkResult, setupMs: number, chromeMs: number) {
  const { planHashMs, sessionBootMs, captureStageMs, encodeStageMs, durationMs } = result;
  return {
    setupMs,
    chromeMs,
    planHashMs,
    sessionBootMs,
    captureStageMs,
    encodeStageMs,
    durationMs,
  };
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
  if (event.PlanProtocol !== "v1") {
    return handleAssembleV2(event, deps);
  }
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
      audioPath = resolvePlanAudioPath(planDir) ?? join(planDir, PLAN_AUDIO_RELATIVE_PATH);
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

// Assembly mirrors the chunk lifecycle while adding assembler-only artifacts;
// keeping the steps local makes its temporary-storage ownership explicit.
// fallow-ignore-next-line complexity
async function handleAssembleV2(
  event: AssembleV2Event,
  deps?: HandlerDeps,
): Promise<AssembleLambdaResult> {
  const started = Date.now();
  const s3 = deps?.s3 ?? getS3Client();
  const primitive = deps?.primitives?.assemble ?? assemble;
  const work = mkdtempSync(join(deps?.tmpRoot ?? tmpdir(), "hf-lambda-assemble-v2-"));
  try {
    const { planDir, manifest } = await downloadAndMaterializePlanV2(
      s3,
      event,
      { role: "assembler" },
      work,
    );
    // Only a plan that left its audio to the audio task takes it by URI; any other v2 plan ships it.
    if (event.AudioS3Uri !== null && !stitchesSeparateAudio(planDir)) {
      const error = new Error("[handler] v2 assemble audio must be materialized from the manifest");
      error.name = "PLAN_PROTOCOL_UNSUPPORTED";
      throw error;
    }
    if (chunksAreStitchedMp4(planDir, event.Cfr === true)) {
      return await stitchChunksInS3(s3, event, manifest, started, deps?.lambda);
    }
    // `downloadAndMaterializePlanV2` materializes atomically. Audio is
    // assembler-only and lives at the familiar v1-compatible location.
    let audioPath = resolvePlanAudioPath(planDir);
    if (event.AudioS3Uri !== null) {
      audioPath = join(planDir, PLAN_AUDIO_RELATIVE_PATH);
      await downloadS3ObjectToFile(s3, event.AudioS3Uri, audioPath);
    }
    const chunksStarted = Date.now();
    const chunkPaths = await downloadChunkObjects(s3, event.ChunkS3Uris, work, event.Format);
    const chunksMs = Date.now() - chunksStarted;
    const finalOutput =
      event.Format === "png-sequence"
        ? join(work, "output-frames")
        : join(work, `output${formatExtension(event.Format)}`);
    const result = await primitive(planDir, chunkPaths, audioPath, finalOutput, {
      cfr: event.Cfr === true,
    });
    const uploadStarted = Date.now();
    if (event.Format === "png-sequence") {
      const tarball = `${finalOutput}.tar.gz`;
      await tarDirectory(finalOutput, tarball);
      await uploadFileToS3(s3, tarball, event.OutputS3Uri, "application/gzip");
    } else {
      await uploadFileToS3(s3, finalOutput, event.OutputS3Uri);
    }
    logEvent({
      event: "assemble_stages",
      planMs: chunksStarted - started,
      chunksMs,
      assembleMs: result.durationMs,
      uploadMs: Date.now() - uploadStarted,
    });
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

async function stitchChunksInS3(
  s3: S3Client,
  event: AssembleV2Event,
  plan: PlanV2Manifest,
  started: number,
  lambda?: LambdaClient,
): Promise<AssembleLambdaResult> {
  if (event.ChunkS3Uris.length !== plan.chunkCount) {
    throw new Error(
      `[handler] ${event.ChunkS3Uris.length} chunk URIs for a plan of ${plan.chunkCount} chunks`,
    );
  }
  const stitchStarted = Date.now();
  const stitched = await stitchMp4InS3(s3, event.ChunkS3Uris, event.OutputS3Uri, {
    audioUri: event.AudioS3Uri ?? undefined,
    helper: stitchHelper(lambda),
  });
  logEvent({
    event: "assemble_stages",
    mode: "s3-stitch",
    planMs: stitchStarted - started,
    stitchMs: Date.now() - stitchStarted,
    parts: stitched.parts,
    downloadedBytes: stitched.downloadedBytes,
    helpers: stitched.helpers,
    helperFallbacks: stitched.helperFallbacks,
  });
  return {
    Action: "assemble",
    OutputS3Uri: event.OutputS3Uri,
    FramesEncoded: plan.totalFrames,
    FileSize: stitched.fileSize,
    DurationMs: Date.now() - started,
  };
}

async function downloadAndMaterializePlanV2(
  s3: S3Client,
  event: {
    PlanV2ManifestS3Uri: string;
    PlanV2ArtifactS3Prefix: string;
    PlanHash: string;
  },
  target: PlanV2MaterializationTarget,
  work: string,
): Promise<{ planDir: string; manifest: PlanV2Manifest }> {
  const transportDir = join(work, "plan-v2");
  mkdirSync(transportDir, { recursive: true });
  await downloadS3ObjectToFile(s3, event.PlanV2ManifestS3Uri, join(transportDir, "plan.json"));
  const manifest = readPlanV2Manifest(transportDir);
  if (manifest.planHash !== event.PlanHash) {
    throwPlanHashMismatch(event.PlanHash, manifest.planHash);
  }
  const artifacts = listPlanV2ArtifactsForTarget(manifest, target);
  const remoteSources = await presignDeferredSources(s3, event.PlanV2ArtifactS3Prefix, artifacts);
  const uniqueArtifacts = [
    ...new Map(
      artifacts
        .filter((artifact) => !Object.hasOwn(remoteSources, artifact.path))
        .map((artifact) => [artifact.sha256, artifact]),
    ).values(),
  ];
  await mapConcurrent(uniqueArtifacts, 16, async (artifact) => {
    await downloadPlanV2Artifact(s3, event.PlanV2ArtifactS3Prefix, transportDir, artifact);
  });
  const planDir = join(work, "plan");
  materializePlanV2Target(transportDir, target, planDir, { remoteSources });
  return { planDir, manifest };
}

/** Outlives the longest chunk (Lambda caps an invocation at 900 s) with margin. */
const DEFERRED_SOURCE_URL_TTL_SECONDS = 3600;

/**
 * A chunk's ffmpeg reads a deferred video by byte range from a pre-signed URL
 * instead of downloading it whole. The key is the content hash, written once.
 */
async function presignDeferredSources(
  s3: S3Client,
  artifactPrefix: string,
  artifacts: readonly Readonly<PlanV2Artifact>[],
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    artifacts
      .filter(isPlanV2DeferredSourceArtifact)
      .map(
        async (artifact) =>
          [
            artifact.path,
            await presignVerifiedS3GetUrl(
              s3,
              planV2BlobUri(artifactPrefix, artifact.sha256),
              artifact.sha256,
              artifact.sizeBytes,
              DEFERRED_SOURCE_URL_TTL_SECONDS,
            ),
          ] as const,
      ),
  );
  return Object.fromEntries(entries);
}

async function downloadPlanV2Artifact(
  s3: S3Client,
  artifactPrefix: string,
  planV2Dir: string,
  artifact: Readonly<PlanV2Artifact>,
): Promise<void> {
  await downloadS3ObjectToFileVerified(
    s3,
    planV2BlobUri(artifactPrefix, artifact.sha256),
    planV2BlobPath(planV2Dir, artifact.sha256),
    artifact.sha256,
  );
}

function planV2BlobPath(planV2Dir: string, digest: string): string {
  return join(planV2Dir, "artifacts", "sha256", digest.slice(0, 2), digest);
}

function planV2BlobUri(prefix: string, digest: string): string {
  return `${trimTrailingSlash(prefix)}/${digest.slice(0, 2)}/${digest}`;
}

function throwPlanHashMismatch(expected: string, actual: string): never {
  const error = new Error(
    `PLAN_HASH_MISMATCH: event PlanHash=${expected} did not match v2 manifest planHash=${actual}`,
  );
  error.name = "PLAN_HASH_MISMATCH";
  throw error;
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
// This is an exhaustive event-union projection used only for safe log summaries.
// fallow-ignore-next-line complexity
function getEventS3Uris(
  event: PlanEvent | AudioEvent | RenderChunkEvent | AssembleEvent,
): string[] {
  switch (event.Action) {
    case "plan":
    case "audio":
      return [event.ProjectS3Uri, event.PlanOutputS3Prefix];
    case "renderChunk":
      return event.PlanProtocol !== "v1"
        ? [event.PlanV2ManifestS3Uri, event.PlanV2ArtifactS3Prefix, event.ChunkOutputS3Prefix]
        : [event.PlanS3Uri, event.ChunkOutputS3Prefix];
    case "assemble":
      return [
        ...(event.PlanProtocol !== "v1"
          ? [event.PlanV2ManifestS3Uri, event.PlanV2ArtifactS3Prefix]
          : [event.PlanS3Uri]),
        ...event.ChunkS3Uris,
        event.OutputS3Uri,
        event.AudioS3Uri,
      ].filter((u): u is string => u != null);
  }
}

/**
 * Parts S3 cannot copy go to the function the stack names: it just ran the chunks, so it is warm,
 * and each invocation brings its own network link.
 */
export function stitchHelper(lambda?: LambdaClient): StitchHelper | undefined {
  const functionName = process.env.HYPERFRAMES_STITCH_FUNCTION?.trim();
  if (!functionName) return undefined;
  const client = lambda ?? new LambdaClient({});
  // This assemble may hold one slot of the reservation itself.
  const reserved = reservedConcurrency();
  const maxInvocations = reserved ? Math.max(1, reserved - 1) : Infinity;
  const send: StitchHelper["send"] = async (target, parts) => {
    const event: StitchPartsEvent = { Action: "stitchParts", ...target, Parts: parts };
    const response = await client.send(
      new InvokeCommand({ FunctionName: functionName, Payload: JSON.stringify(event) }),
    );
    const body = JSON.parse(
      new TextDecoder().decode(response.Payload),
    ) as StitchPartsLambdaResult & {
      errorMessage?: string;
      errorType?: string;
    };
    if (response.FunctionError) {
      const error = new Error(
        `[handler] stitchParts on ${functionName} failed: ${body.errorMessage ?? response.FunctionError}`,
      );
      if (body.errorType) error.name = body.errorType;
      throw error;
    }
    return body.ETags;
  };
  return { send, maxInvocations };
}

async function handleStitchParts(
  event: StitchPartsEvent,
  deps?: HandlerDeps,
): Promise<StitchPartsLambdaResult> {
  const { Bucket, Key, UploadId, Parts } = event;
  assertAllowedBuckets([
    `s3://${Bucket}/${Key}`,
    ...Parts.flatMap((part) => part.ranges.map((r) => r.uri)),
  ]);
  const ETags = await sendRangeParts(deps?.s3 ?? getS3Client(), { Bucket, Key, UploadId }, Parts);
  return { Action: "stitchParts", ETags };
}

/**
 * Verify every S3 URI in the event resolves to the configured render bucket.
 * Throws `S3_URI_NOT_ALLOWED` (non-retryable) when a URI targets a different
 * bucket, preventing event injection from reading or writing arbitrary S3 data.
 *
 * Skipped when `HYPERFRAMES_RENDER_BUCKET` is unset so existing deployments
 * without the env var continue to work.
 */
function validateEventS3Uris(
  event: PlanEvent | AudioEvent | RenderChunkEvent | AssembleEvent,
): void {
  assertAllowedBuckets(getEventS3Uris(event));
}

function assertAllowedBuckets(uris: Iterable<string>): void {
  const allowedBucket = process.env.HYPERFRAMES_RENDER_BUCKET?.trim();
  if (!allowedBucket) return;

  for (const uri of uris) {
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
