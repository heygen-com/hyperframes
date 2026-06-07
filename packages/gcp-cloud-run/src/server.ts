/**
 * Cloud Run request handler for HyperFrames distributed rendering.
 *
 * One container image, three roles. Cloud Workflows POSTs a JSON body with
 * an `Action` field; the handler unwraps any `Payload`/`Input` envelope,
 * primes the runtime (Chrome path), and forwards to the matching OSS
 * primitive from `@hyperframes/producer/distributed`.
 *
 * Everything heavy — capture, encode, audio mix — happens inside the OSS
 * primitives. The handler is thin glue: parse body → GCS download → call
 * primitive → GCS upload → return small JSON result.
 *
 * `dispatch()` is the testable core (inject `storage` + `primitives`); the
 * Hono app at the bottom is the HTTP shell the Dockerfile runs. The shape
 * deliberately tracks `@hyperframes/aws-lambda`'s `handler.ts` so the two
 * adapters stay easy to diff.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Storage } from "@google-cloud/storage";
import { Hono } from "hono";
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
import type {
  AssembleEvent,
  AssembleResultBody,
  CloudRunAction,
  CloudRunEvent,
  CloudRunResult,
  PlanEvent,
  PlanResultBody,
  RenderChunkEvent,
  RenderChunkResultBody,
} from "./events.js";
import { type DistributedFormat, formatExtension } from "./formatExtension.js";
import {
  downloadGcsObjectToFile,
  parseGcsUri,
  tarDirectory,
  untarDirectory,
  uploadFileToGcs,
} from "./gcsTransport.js";

/**
 * Lazily-constructed Storage client. Cached at module scope so warm
 * container instances reuse the underlying HTTP keep-alive pool across
 * requests.
 */
let cachedStorage: Storage | null = null;
function getStorage(): Storage {
  if (cachedStorage) return cachedStorage;
  cachedStorage = new Storage();
  return cachedStorage;
}

/**
 * Optional injection points used by the handler's unit tests. Production
 * callers leave these unset; the real OSS primitives are used. Tests inject
 * `storage` and `primitives` directly rather than mutating module state.
 */
export interface HandlerDeps {
  storage?: Storage;
  primitives?: {
    plan: typeof plan;
    renderChunk: typeof renderChunk;
    assemble: typeof assemble;
  };
  /** Override the per-request workdir root (defaults to the OS tmpdir). */
  tmpRoot?: string;
  /** Skip Chrome resolution (used by dispatch tests that mock renderChunk). */
  skipChromeResolution?: boolean;
}

/**
 * Dispatch a single render request. Cloud Workflows (or a direct caller)
 * sometimes wraps the body in `{ Payload: ... }` or `{ Input: ... }`; unwrap
 * until we hit a discriminated event.
 */
// fallow-ignore-next-line complexity
export async function dispatch(event: CloudRunEvent, deps?: HandlerDeps): Promise<CloudRunResult> {
  const unwrapped = unwrapEvent(event);
  validateEventGcsUris(unwrapped);
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
        // Compile-time exhaustiveness: a new CloudRunAction member trips
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
    logEvent({
      event: "handler_error",
      action: unwrapped.Action,
      message: err instanceof Error ? err.message : String(err),
      name: err instanceof Error ? err.name : undefined,
    });
    throw err;
  }
}

// At most `{Payload: {Input: ...}}` is expected; 4 levels is 2× headroom
// and prevents infinite loops on malformed input.
const MAX_ENVELOPE_DEPTH = 4;

// fallow-ignore-next-line complexity
export function unwrapEvent(event: CloudRunEvent): PlanEvent | RenderChunkEvent | AssembleEvent {
  let cursor: CloudRunEvent = event;
  for (let i = 0; i < MAX_ENVELOPE_DEPTH; i++) {
    if (cursor && typeof cursor === "object") {
      const obj = cursor as Record<string, unknown>;
      if (typeof obj.Action === "string" && isCloudRunAction(obj.Action)) {
        return cursor as PlanEvent | RenderChunkEvent | AssembleEvent;
      }
      if ("Payload" in obj) {
        cursor = obj.Payload as CloudRunEvent;
        continue;
      }
      if ("Input" in obj) {
        cursor = obj.Input as CloudRunEvent;
        continue;
      }
    }
    break;
  }
  throw new Error(
    `[handler] body has no recognised Action; unwrapped ${MAX_ENVELOPE_DEPTH} levels of Payload/Input without finding one.`,
  );
}

function isCloudRunAction(value: string): value is CloudRunAction {
  return value === "plan" || value === "renderChunk" || value === "assemble";
}

/**
 * Emit a single JSON line to stdout. Cloud Logging ingests each stdout line
 * as a structured `jsonPayload` entry, so Logs Explorer can filter on
 * `jsonPayload.event="handler_start"` and project specific fields when
 * triaging without attaching a debugger.
 */
function logEvent(payload: Record<string, unknown>): void {
  console.log(JSON.stringify(payload));
}

/**
 * Compact, non-PII summary of an event for logging. The full body can
 * include the entire project config; we only emit the routable fields
 * needed to triage a failure from Cloud Logging.
 */
function summarizeEvent(
  event: PlanEvent | RenderChunkEvent | AssembleEvent,
): Record<string, unknown> {
  switch (event.Action) {
    case "plan":
      return {
        projectGcsUri: event.ProjectGcsUri,
        planOutputGcsPrefix: event.PlanOutputGcsPrefix,
        format: event.Config.format,
        fps: event.Config.fps,
      };
    case "renderChunk":
      return {
        planGcsUri: event.PlanGcsUri,
        chunkIndex: event.ChunkIndex,
        format: event.Format,
      };
    case "assemble":
      return {
        planGcsUri: event.PlanGcsUri,
        chunkCount: event.ChunkGcsUris.length,
        hasAudio: event.AudioGcsUri !== null,
        outputGcsUri: event.OutputGcsUri,
        format: event.Format,
      };
  }
}

/**
 * Point the engine at the in-image Chrome binary. The OSS engine resolves
 * Chrome via `PRODUCER_HEADLESS_SHELL_PATH` first; set it once per instance
 * before invoking any browser-touching primitive. ffmpeg is on the image's
 * PATH (apt-installed by the Dockerfile), so nothing to prime there.
 */
function primeChrome(deps?: HandlerDeps): void {
  if (deps?.skipChromeResolution) return;
  if (process.env.PRODUCER_HEADLESS_SHELL_PATH) return;
  process.env.PRODUCER_HEADLESS_SHELL_PATH = resolveChromeExecutablePath();
}

// ── Plan ────────────────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
async function handlePlan(event: PlanEvent, deps?: HandlerDeps): Promise<PlanResultBody> {
  const started = Date.now();
  const storage = deps?.storage ?? getStorage();
  const primitive = deps?.primitives?.plan ?? plan;

  // The producer's probe stage launches Chromium whenever the composition
  // needs a runtime duration probe or has unresolved sub-compositions, so
  // plan has to resolve Chrome the same way renderChunk does.
  primeChrome(deps);

  const work = mkdtempSync(join(deps?.tmpRoot ?? tmpdir(), "hf-cr-plan-"));
  const projectArchive = join(work, "project.tar.gz");
  const projectDir = join(work, "project");
  const planDir = join(work, "plan");

  try {
    await downloadGcsObjectToFile(storage, event.ProjectGcsUri, projectArchive);
    await untarDirectory(projectArchive, projectDir);

    const config: DistributedRenderConfig = {
      ...event.Config,
    };
    const result: PlanResult = await primitive(projectDir, config, planDir);

    // Upload the planDir as a single tarball. The workflow cannot pass a
    // directory-shaped artifact between steps; we serialize and rely on the
    // consumer (renderChunk / assemble) to untar. `audio.aac` lives inside
    // planDir, so it already rides along in this tarball — every consumer
    // (including assemble) gets it from the untar. We deliberately do NOT
    // upload a separate audio object: it would duplicate the bytes on every
    // plan upload and be re-downloaded + overwritten by assemble. `AudioGcsUri`
    // stays in the result shape for wire compatibility but is null.
    const planTar = join(work, "plan.tar.gz");
    await tarDirectory(planDir, planTar);
    const planTarUri = `${trimTrailingSlash(event.PlanOutputGcsPrefix)}/plan.tar.gz`;
    const audioPath = join(planDir, "audio.aac");
    const hasAudio = existsSync(audioPath) && statSync(audioPath).size > 0;
    await uploadFileToGcs(storage, planTar, planTarUri, "application/gzip");

    return {
      Action: "plan",
      PlanGcsUri: planTarUri,
      PlanHash: result.planHash,
      ChunkCount: result.chunkCount,
      TotalFrames: result.totalFrames,
      Fps: result.fps,
      Width: result.width,
      Height: result.height,
      Format: result.format,
      HasAudio: hasAudio,
      AudioGcsUri: null,
      FfmpegVersion: result.ffmpegVersion,
      ProducerVersion: result.producerVersion,
      DurationMs: Date.now() - started,
    };
  } finally {
    cleanupDir(work);
  }
}

// ── RenderChunk ─────────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
async function handleRenderChunk(
  event: RenderChunkEvent,
  deps?: HandlerDeps,
): Promise<RenderChunkResultBody> {
  const started = Date.now();
  const storage = deps?.storage ?? getStorage();
  const primitive = deps?.primitives?.renderChunk ?? renderChunk;

  primeChrome(deps);

  const work = mkdtempSync(join(deps?.tmpRoot ?? tmpdir(), "hf-cr-chunk-"));
  const planTar = join(work, "plan.tar.gz");
  const planDir = join(work, "plan");

  try {
    await downloadGcsObjectToFile(storage, event.PlanGcsUri, planTar);
    await untarDirectory(planTar, planDir);

    // Verify the plan's hash matches what the workflow told us to render.
    // The producer's renderChunk re-checks internally (defense-in-depth),
    // but doing it here at the handler boundary lets us fail before paying
    // the Chrome-launch + render cost on a misrouted chunk. Throws a typed
    // PLAN_HASH_MISMATCH the workflow can route as non-retryable.
    verifyPlanHash(planDir, event.PlanHash);

    const chunkOutputBase = join(
      work,
      event.Format === "png-sequence"
        ? `chunk-${pad(event.ChunkIndex)}`
        : `chunk-${pad(event.ChunkIndex)}${formatExtension(event.Format)}`,
    );

    const result: ChunkResult = await primitive(planDir, event.ChunkIndex, chunkOutputBase);

    const chunkUri = await uploadChunkOutput(
      storage,
      result,
      event.ChunkOutputGcsPrefix,
      event.ChunkIndex,
    );

    return {
      Action: "renderChunk",
      ChunkGcsUri: chunkUri,
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
  storage: Storage,
  result: ChunkResult,
  prefix: string,
  chunkIndex: number,
): Promise<string> {
  const trimmed = trimTrailingSlash(prefix);
  if (result.outputKind === "file") {
    const ext = extname(result.outputPath);
    const uri = `${trimmed}/chunks/${pad(chunkIndex)}${ext}`;
    await uploadFileToGcs(storage, result.outputPath, uri);
    return uri;
  }
  // frame-dir: upload as a tarball so a single GCS object represents the
  // chunk. Assemble's png-sequence path expects a directory per chunk; it
  // untars on its end.
  const tarball = `${result.outputPath}.tar.gz`;
  await tarDirectory(result.outputPath, tarball);
  const uri = `${trimmed}/chunks/${pad(chunkIndex)}.tar.gz`;
  await uploadFileToGcs(storage, tarball, uri, "application/gzip");
  return uri;
}

// ── Assemble ────────────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
async function handleAssemble(
  event: AssembleEvent,
  deps?: HandlerDeps,
): Promise<AssembleResultBody> {
  const started = Date.now();
  const storage = deps?.storage ?? getStorage();
  const primitive = deps?.primitives?.assemble ?? assemble;

  const work = mkdtempSync(join(deps?.tmpRoot ?? tmpdir(), "hf-cr-assemble-"));
  const planTar = join(work, "plan.tar.gz");
  const planDir = join(work, "plan");

  try {
    await downloadGcsObjectToFile(storage, event.PlanGcsUri, planTar);
    await untarDirectory(planTar, planDir);

    const chunkPaths = await downloadChunkObjects(storage, event.ChunkGcsUris, work, event.Format);

    // Audio rides inside the plan tarball, so it's already on disk after the
    // untar above — no separate download. Fall back to a supplied AudioGcsUri
    // only for backward compatibility with an older Plan that uploaded it
    // standalone.
    let audioPath: string | null = null;
    const planAudio = join(planDir, "audio.aac");
    if (existsSync(planAudio) && statSync(planAudio).size > 0) {
      audioPath = planAudio;
    } else if (event.AudioGcsUri) {
      audioPath = planAudio;
      await downloadGcsObjectToFile(storage, event.AudioGcsUri, audioPath);
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
      await uploadFileToGcs(storage, tarball, event.OutputGcsUri, "application/gzip");
    } else {
      await uploadFileToGcs(storage, finalOutput, event.OutputGcsUri);
    }

    return {
      Action: "assemble",
      OutputGcsUri: event.OutputGcsUri,
      FramesEncoded: result.framesEncoded,
      FileSize: result.fileSize,
      DurationMs: Date.now() - started,
    };
  } finally {
    cleanupDir(work);
  }
}

async function downloadChunkObjects(
  storage: Storage,
  uris: string[],
  workDir: string,
  format: DistributedFormat,
): Promise<string[]> {
  const chunksDir = join(workDir, "chunks");
  mkdirSync(chunksDir, { recursive: true });
  // Each chunk is an independent GCS GET (+ untar for png-sequence). Run
  // them in parallel — assemble's wall-clock is otherwise dominated by
  // `Σ chunk-download-ms` instead of `max(chunk-download-ms)`. Preserve the
  // input order by writing into a pre-sized array rather than pushing as
  // each task settles.
  const local: string[] = new Array<string>(uris.length);
  await Promise.all(
    uris.map(async (uri, i) => {
      if (!uri) {
        throw new Error(`[handler] chunk URI at index ${i} is empty`);
      }
      const { key } = parseGcsUri(uri);
      const localPath = join(chunksDir, basename(key));
      await downloadGcsObjectToFile(storage, uri, localPath);
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

/** Collect every GCS URI that the handler will touch for a given event. */
function getEventGcsUris(event: PlanEvent | RenderChunkEvent | AssembleEvent): string[] {
  switch (event.Action) {
    case "plan":
      return [event.ProjectGcsUri, event.PlanOutputGcsPrefix];
    case "renderChunk":
      return [event.PlanGcsUri, event.ChunkOutputGcsPrefix];
    case "assemble":
      return [
        event.PlanGcsUri,
        ...event.ChunkGcsUris,
        event.OutputGcsUri,
        event.AudioGcsUri,
      ].filter((u): u is string => u != null);
  }
}

/** Emit the "guard disabled" warning at most once per instance. */
let warnedAllowlistDisabled = false;

/**
 * Verify every GCS URI in the event resolves to the configured render
 * bucket. Throws `GCS_URI_NOT_ALLOWED` (non-retryable) when a URI targets a
 * different bucket, preventing request injection from reading or writing
 * arbitrary GCS data.
 *
 * Opt-out is explicit: set `HYPERFRAMES_RENDER_BUCKET="*"` to disable the
 * guard intentionally. If the env var is simply unset (or empty), the guard
 * is disabled but a warning is logged once so the gap is visible in Cloud
 * Logging — it shouldn't silently fail open. The Terraform module always
 * wires the bucket name, so the prod path enforces.
 */
// fallow-ignore-next-line complexity
function validateEventGcsUris(event: PlanEvent | RenderChunkEvent | AssembleEvent): void {
  const allowedBucket = process.env.HYPERFRAMES_RENDER_BUCKET?.trim();
  if (allowedBucket === "*") return; // explicit, intentional opt-out
  if (!allowedBucket) {
    if (!warnedAllowlistDisabled) {
      warnedAllowlistDisabled = true;
      logEvent({
        event: "bucket_allowlist_disabled",
        level: "WARNING",
        message:
          "HYPERFRAMES_RENDER_BUCKET is unset — the GCS bucket-allowlist guard is DISABLED. " +
          'Set it to the render bucket name to enforce, or to "*" to opt out intentionally.',
      });
    }
    return;
  }

  for (const uri of getEventGcsUris(event)) {
    const { bucket } = parseGcsUri(uri);
    if (bucket !== allowedBucket) {
      const err = new Error(
        `[handler] GCS_URI_NOT_ALLOWED: URI ${JSON.stringify(uri)} targets bucket "${bucket}" but only "${allowedBucket}" is permitted`,
      );
      err.name = "GCS_URI_NOT_ALLOWED";
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
    // Cloud Run re-uses an instance's filesystem across requests; clean up
    // aggressively so we don't leak a chunk-sized footprint between renders
    // (the writable filesystem counts against the instance's memory).
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best-effort — leak is preferable to crashing on the success path.
  }
}

/**
 * Read the untarred planDir's `plan.json` and assert its `planHash` matches
 * what the workflow event claims. Throws on mismatch with a typed
 * `PLAN_HASH_MISMATCH` error name so the workflow's non-retryable list
 * routes it correctly. Defense-in-depth — the producer's `renderChunk` does
 * the same check internally — but performing it here lets us fail before
 * paying the Chrome-launch + per-frame capture cost on a misrouted chunk.
 */
// fallow-ignore-next-line complexity
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

// ── HTTP shell ───────────────────────────────────────────────────────────────

/**
 * Error names the workflow treats as non-retryable. A request that fails
 * with one of these is the caller's fault (bad input, misrouted chunk) and
 * retrying it just burns instance-seconds, so we map them to HTTP 400 while
 * any other failure maps to 500 (which the workflow retry policy backs off
 * and re-attempts). Keep this list in sync with the `retry` predicate in
 * `packages/gcp-cloud-run/terraform/workflow.yaml`.
 */
const NON_RETRYABLE_ERROR_NAMES = new Set([
  // Handler-boundary guards.
  "GCS_URI_NOT_ALLOWED",
  "PLAN_HASH_MISMATCH",
  // Producer error class names (`.name`) + their string code aliases — the
  // class sets `.name` to the class name but wraps a `code`; cover both so a
  // raw-code throw is caught too. Mirrors the AWS state machine's
  // non-retryable list.
  "FormatNotSupportedInDistributedError",
  "PlanTooLargeError",
  "RenderChunkValidationError",
  "FFMPEG_VERSION_MISMATCH",
  "FORMAT_NOT_SUPPORTED_IN_DISTRIBUTED",
  "PLAN_TOO_LARGE",
  "BROWSER_GPU_NOT_SOFTWARE",
  "FONT_FETCH_FAILED",
  "ChromeBinaryUnavailableError",
]);

/**
 * Build the Hono app. A single `POST /` endpoint dispatches on the body's
 * `Action` field — the workflow points every step (plan, each renderChunk,
 * assemble) at the same URL and varies only the body. `GET /healthz` backs
 * the Cloud Run startup/liveness probe.
 *
 * `deps` is threaded through so tests can drive the real HTTP surface with
 * an injected Storage double + mocked primitives.
 */
export function createApp(deps?: HandlerDeps): Hono {
  const app = new Hono();

  app.get("/healthz", (c) => c.json({ status: "ok" }));

  // fallow-ignore-next-line complexity
  app.post("/", async (c) => {
    let body: CloudRunEvent;
    try {
      body = (await c.req.json()) as CloudRunEvent;
    } catch {
      return c.json({ error: "BAD_REQUEST", message: "request body must be JSON" }, 400);
    }
    try {
      const result = await dispatch(body, deps);
      return c.json(result, 200);
    } catch (err) {
      const name = err instanceof Error ? err.name : undefined;
      const message = err instanceof Error ? err.message : String(err);
      const status = name && NON_RETRYABLE_ERROR_NAMES.has(name) ? 400 : 500;
      // Surface `error` (the name) as the discriminator the workflow's
      // retry predicate keys off, plus `message` for human triage.
      return c.json({ error: name ?? "RenderError", message }, status);
    }
  });

  return app;
}

/** Start the HTTP server. Cloud Run injects `PORT` (default 8080). */
export function startServer(): void {
  const port = Number(process.env.PORT ?? 8080);
  const app = createApp();
  serve({ fetch: app.fetch, port }, (info) => {
    logEvent({ event: "server_listening", port: info.port });
  });
}

// Boot when executed directly (the Dockerfile runs `node dist/server.js`),
// but not when imported by tests or the SDK.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer();
}
