#!/usr/bin/env node
/**
 * @hyperframes/producer — Public Server
 *
 * Clean HTTP API for rendering HTML compositions to video.
 *
 * Routes:
 *   POST /render         — blocking render, returns JSON
 *   POST /render/stream  — SSE streaming render with progress
 *   GET  /render/queue   — current render queue status
 *   POST /lint           — blocking Hyperframe lint
 *   GET  /health         — health check
 *   GET  /outputs/:token — download rendered MP4
 */

import {
  existsSync,
  mkdirSync,
  statSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  createReadStream,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import crypto from "node:crypto";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import {
  RenderCancelledError,
  createRenderJob,
  executeRenderJob,
  type RenderConfig,
} from "./services/renderOrchestrator.js";
import { prepareHyperframeLintBody, runHyperframeLint } from "./services/hyperframeLint.js";
import { startHealthWorker, type HealthWorkerHandle } from "./services/healthWorker.js";
import { isVideoFrameFormat } from "@hyperframes/engine";
import { resolveRenderPaths } from "./utils/paths.js";
import { defaultLogger, type ProducerLogger } from "./logger.js";
import { Semaphore } from "./utils/semaphore.js";
import { parseFps, normalizeResolutionFlag, type CanvasResolution } from "@hyperframes/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface HandlerOptions {
  /** Custom logger. Defaults to console-based defaultLogger. */
  logger?: ProducerLogger;
  /** Extract or generate a request ID. Defaults to x-request-id header or random UUID. */
  getRequestId?: (c: Context) => string;
  /** Directory for rendered output files. Defaults to PRODUCER_RENDERS_DIR or /tmp. */
  rendersDir?: string;
  /** Prefix for output URLs in responses. Default: "/outputs". */
  outputUrlPrefix?: string;
  /** TTL for output artifact download tokens (ms). Default: 15 minutes. */
  artifactTtlMs?: number;
  /** Max renders that execute simultaneously. Queued requests wait FIFO. Default: 2. */
  maxConcurrentRenders?: number;
}

export interface ServerOptions extends HandlerOptions {
  /** Port to listen on. Default: 9847. */
  port?: number;
}

// ---------------------------------------------------------------------------
// Shared validation helpers
// ---------------------------------------------------------------------------
interface RenderInput {
  projectDir: string;
  outputPath?: string | null;
  fps: import("@hyperframes/core").Fps;
  quality: "draft" | "standard" | "high";
  format?: "mp4" | "webm" | "mov";
  videoFrameFormat?: RenderConfig["videoFrameFormat"];
  workers?: number;
  useGpu: boolean;
  debug: boolean;
  entryFile?: string;
  /**
   * data-composition-variables overrides forwarded into the render config.
   * Without this the HTTP/server render path silently rendered the
   * composition's declared defaults, ignoring per-request overrides.
   */
  variables?: Record<string, unknown>;
  /**
   * Output resolution preset (e.g. `landscape-4k`). Drives the same
   * `resolveDeviceScaleFactor` supersampling path the local CLI uses — Chrome
   * renders at a higher devicePixelRatio so the captured screenshot lands at
   * the requested dimensions. Aspect ratio must match the composition.
   */
  outputResolution?: CanvasResolution;
}

interface PreparedRenderInput {
  input: RenderInput;
  cleanupProjectDir?: string;
}

export function parseRenderOptions(body: Record<string, unknown>): Omit<RenderInput, "projectDir"> {
  // Accept either a JSON `number` (integer fps) or a JSON `string` (rational
  // like "30000/1001"). Falls back to 30 fps on parse failure to preserve the
  // forgiving behaviour the original whitelist had — the producer surfaces a
  // clearer downstream error if the value is genuinely unusable.
  const fpsRaw = body.fps;
  const fpsParse =
    typeof fpsRaw === "number" || typeof fpsRaw === "string" ? parseFps(fpsRaw) : null;
  const fps = fpsParse && fpsParse.ok ? fpsParse.value : ({ num: 30, den: 1 } as const);
  const quality = (
    ["draft", "standard", "high"].includes(body.quality as string) ? body.quality : "high"
  ) as "draft" | "standard" | "high";
  const workers = typeof body.workers === "number" ? body.workers : undefined;
  const useGpu = body.gpu === true;
  const debug = body.debug === true;
  const outputPath =
    typeof body.outputPath === "string" && body.outputPath.trim().length > 0
      ? body.outputPath
      : typeof body.output === "string" && body.output.trim().length > 0
        ? body.output
        : null;

  const entryFile =
    typeof body.entryFile === "string" && body.entryFile.trim().length > 0
      ? body.entryFile.trim()
      : undefined;

  const format = (
    ["mp4", "webm", "mov"].includes(body.format as string) ? body.format : undefined
  ) as RenderInput["format"];
  const videoFrameFormat = isVideoFrameFormat(body.videoFrameFormat)
    ? body.videoFrameFormat
    : undefined;

  const { variables, outputResolution } = parseRenderOverrides(body);

  return {
    outputPath,
    fps,
    quality,
    workers,
    useGpu,
    debug,
    entryFile,
    format,
    variables,
    outputResolution,
    videoFrameFormat,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse the lenient form of the variable + resolution overrides used by
 * `parseRenderOptions`. Invalid shapes coerce to `undefined` here;
 * `validateRenderOverrides` separately rejects explicitly-supplied bad values
 * with a 400 so they aren't silently ignored.
 */
function parseRenderOverrides(body: Record<string, unknown>): {
  variables?: Record<string, unknown>;
  outputResolution?: CanvasResolution;
} {
  // Only forward a plain JSON object. Arrays / primitives / null → undefined.
  const variables = isPlainObject(body.variables) ? body.variables : undefined;
  // Accept canonical presets and aliases ("4k", "landscape-4k", …).
  const outputResolution =
    typeof body.outputResolution === "string"
      ? normalizeResolutionFlag(body.outputResolution)
      : undefined;
  return { variables, outputResolution };
}

/**
 * Build the `createRenderJob` config from a prepared render input. Shared by
 * the sync (`render`) and streaming (`render-stream`) handlers so the field
 * set — including `variables` and `outputResolution` — stays in one place.
 */
function buildRenderJobConfig(input: RenderInput, log: ProducerLogger) {
  return {
    fps: input.fps,
    quality: input.quality,
    format: input.format,
    workers: input.workers,
    useGpu: input.useGpu,
    debug: input.debug,
    entryFile: input.entryFile,
    variables: input.variables,
    outputResolution: input.outputResolution,
    videoFrameFormat: input.videoFrameFormat,
    logger: log,
  };
}

/**
 * Resolve the destination path for a prepared render and ensure its parent
 * directory exists. Shared by the sync + streaming handlers (their only
 * difference is how a `prepareRenderBody` error is surfaced — JSON vs SSE —
 * which stays in each handler).
 */
function resolvePreparedRenderOutput(
  prepared: PreparedRenderInput,
  rendersDir: string,
  log: ProducerLogger,
): { input: RenderInput; cleanupProjectDir?: string; absoluteOutputPath: string } {
  const { input, cleanupProjectDir } = prepared;
  const absoluteOutputPath = resolveOutputPath(input.projectDir, input.outputPath, rendersDir, log);
  const outputDir = dirname(absoluteOutputPath);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  return { input, cleanupProjectDir, absoluteOutputPath };
}

/**
 * Validate explicitly-supplied render overrides that can't be sanely coerced.
 * Returns an error string for a clean 400, or `undefined` when the body is
 * acceptable (including when the fields are simply absent).
 */
function validateRenderOverrides(body: Record<string, unknown>): string | undefined {
  if (body.variables !== undefined && !isPlainObject(body.variables)) {
    return 'variables must be a JSON object keyed by variable id (e.g. {"title":"Hello"})';
  }
  return validateOutputResolutionOverride(body);
}

/**
 * Validate an explicitly-supplied `outputResolution`. Rejects (a) non-string
 * values, which parseRenderOverrides would otherwise silently coerce to
 * `undefined`; (b) unknown presets; and (c) the alpha-format combination —
 * outputResolution drives deviceScaleFactor supersampling, which the webm/mov
 * capture path can't apply (resolveDeviceScaleFactor throws mid-render), so we
 * reject it here for a clean 400 regardless of which caller sent it.
 */
function validateOutputResolutionOverride(body: Record<string, unknown>): string | undefined {
  if (body.outputResolution === undefined) return undefined;
  if (typeof body.outputResolution !== "string") {
    return 'outputResolution must be a string preset (e.g. "4k", "landscape-4k")';
  }
  const normalized = normalizeResolutionFlag(body.outputResolution);
  if (body.outputResolution.trim().length > 0 && normalized === undefined) {
    return `Invalid outputResolution "${body.outputResolution}". Must be one of: landscape, portrait, landscape-4k, portrait-4k, square, square-4k (aliases: 1080p, 4k, …).`;
  }
  if (normalized !== undefined && (body.format === "webm" || body.format === "mov")) {
    return `outputResolution is not supported with format "${body.format}" — the alpha (webm/mov) capture path can't supersample. Use format "mp4", or omit outputResolution to render at the composition's native dimensions.`;
  }
  return undefined;
}

export async function prepareRenderBody(
  body: Record<string, unknown>,
): Promise<{ prepared: PreparedRenderInput } | { error: string }> {
  // Reject explicitly-supplied-but-malformed overrides up front so the caller
  // gets a clear 400 instead of a silently-ignored value.
  const overrideError = validateRenderOverrides(body);
  if (overrideError) return { error: overrideError };

  const options = parseRenderOptions(body);
  const projectDir = typeof body.projectDir === "string" ? body.projectDir : undefined;
  if (projectDir) {
    const absProjectDir = resolve(projectDir);
    if (!existsSync(absProjectDir) || !statSync(absProjectDir).isDirectory()) {
      return { error: `Project directory not found: ${absProjectDir}` };
    }
    const entry = options.entryFile || "index.html";
    if (!existsSync(resolve(absProjectDir, entry))) {
      return { error: `Entry file "${entry}" not found in project directory: ${absProjectDir}` };
    }
    return { prepared: { input: { projectDir: absProjectDir, ...options } } };
  }

  const previewUrl = typeof body.previewUrl === "string" ? body.previewUrl.trim() : "";
  const inlineHtml = typeof body.html === "string" ? body.html : "";
  if (!previewUrl && !inlineHtml) {
    return { error: "Missing render source: provide projectDir, previewUrl, or html" };
  }

  let htmlContent = inlineHtml;
  if (!htmlContent) {
    try {
      const response = await fetch(previewUrl, { method: "GET" });
      if (!response.ok) {
        return { error: `Failed to fetch previewUrl: ${response.status} ${response.statusText}` };
      }
      htmlContent = await response.text();
    } catch (error) {
      return {
        error: `Failed to fetch previewUrl: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  const tempRoot = process.env.PRODUCER_TMP_PROJECT_DIR || tmpdir();
  const tempProjectDir = mkdtempSync(join(tempRoot, "producer-project-"));
  writeFileSync(join(tempProjectDir, "index.html"), htmlContent, "utf-8");
  return {
    prepared: {
      input: {
        projectDir: tempProjectDir,
        ...options,
      },
      cleanupProjectDir: tempProjectDir,
    },
  };
}

function resolveOutputPath(
  projectDir: string,
  outputCandidate: string | null | undefined,
  rendersDir: string,
  log: ProducerLogger,
): string {
  try {
    return resolveRenderPaths(projectDir, outputCandidate, rendersDir).absoluteOutputPath;
  } catch (error) {
    const fallbackPath = resolve(rendersDir, `producer-fallback-${Date.now()}.mp4`);
    log.warn("Failed to resolve output path, using fallback", {
      fallback: fallbackPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return fallbackPath;
  }
}

// ---------------------------------------------------------------------------
// Output artifact management
// ---------------------------------------------------------------------------
interface OutputArtifact {
  path: string;
  expiresAtMs: number;
}

function createArtifactStore(ttlMs: number) {
  const artifacts = new Map<string, OutputArtifact>();

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [token, artifact] of artifacts.entries()) {
      if (artifact.expiresAtMs <= now) {
        artifacts.delete(token);
      }
    }
  }, 60_000);
  cleanup.unref();

  return {
    register(path: string): string {
      const token = crypto.randomUUID();
      artifacts.set(token, { path, expiresAtMs: Date.now() + ttlMs });
      return token;
    },
    get(token: string): OutputArtifact | undefined {
      return artifacts.get(token);
    },
    delete(token: string) {
      artifacts.delete(token);
    },
  };
}

function cleanupTempDir(dir: string | undefined, log: ProducerLogger): void {
  if (!dir) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    log.warn("Failed to cleanup temp project dir", {
      cleanupProjectDir: dir,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------
export interface RenderHandlers {
  render: (c: Context) => Promise<Response>;
  renderStream: (c: Context) => Response | Promise<Response>;
  lint: (c: Context) => Promise<Response>;
  health: (c: Context) => Response;
  outputs: (c: Context) => Response;
  queue: (c: Context) => Response;
}

/**
 * Create route handler functions for the producer server.
 *
 * These can be mounted on any Hono app at any path prefix.
 */
export function createRenderHandlers(options: HandlerOptions = {}): RenderHandlers {
  const log = options.logger ?? defaultLogger;
  const getRequestId =
    options.getRequestId ?? ((c: Context) => c.req.header("x-request-id") || crypto.randomUUID());
  const outputUrlPrefix = options.outputUrlPrefix ?? "/outputs";
  const rendersDir = options.rendersDir ?? process.env.PRODUCER_RENDERS_DIR ?? "/tmp";
  const artifactTtlMs =
    options.artifactTtlMs ?? Number(process.env.PRODUCER_OUTPUT_ARTIFACT_TTL_MS || 15 * 60 * 1000);
  const store = createArtifactStore(artifactTtlMs);
  const maxConcurrentRenders =
    options.maxConcurrentRenders ?? Number(process.env.PRODUCER_MAX_CONCURRENT_RENDERS || 2);
  const renderSemaphore = new Semaphore(maxConcurrentRenders);
  const startTime = Date.now();

  const health = (c: Context): Response =>
    c.json({
      status: "ok",
      uptime: Math.floor((Date.now() - startTime) / 1000),
      timestamp: new Date().toISOString(),
    });

  const lint = async (c: Context): Promise<Response> => {
    const requestId = getRequestId(c);

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, requestId, error: "Invalid JSON body" }, 400);
    }

    const preparedResult = prepareHyperframeLintBody(body);
    if ("error" in preparedResult) {
      return c.json({ success: false, requestId, error: preparedResult.error }, 400);
    }

    const result = await runHyperframeLint(preparedResult.prepared);
    log.info("lint completed", {
      requestId,
      entryFile: preparedResult.prepared.entryFile,
      source: preparedResult.prepared.source,
      errorCount: result.errorCount,
      warningCount: result.warningCount,
    });

    return c.json({
      success: true,
      requestId,
      entryFile: preparedResult.prepared.entryFile,
      source: preparedResult.prepared.source,
      result,
    });
  };

  const render = async (c: Context): Promise<Response> => {
    const requestId = getRequestId(c);
    const t0 = Date.now();

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, requestId, error: "Invalid JSON body" }, 400);
    }

    const preparedResult = await prepareRenderBody(body);
    if ("error" in preparedResult) {
      return c.json({ success: false, requestId, error: preparedResult.error }, 400);
    }

    const { input, cleanupProjectDir, absoluteOutputPath } = resolvePreparedRenderOutput(
      preparedResult.prepared,
      rendersDir,
      log,
    );

    const release = await renderSemaphore.acquire();

    log.info("render started", {
      requestId,
      projectDir: input.projectDir,
      fps: input.fps,
      quality: input.quality,
    });

    const job = createRenderJob(buildRenderJobConfig(input, log));

    let lastLoggedPct = -10;
    try {
      await executeRenderJob(job, input.projectDir, absoluteOutputPath, async (j, message) => {
        const pct = Math.floor(j.progress * 100);
        if (pct >= lastLoggedPct + 10) {
          lastLoggedPct = pct;
          log.info(`render progress ${pct}%`, { requestId, stage: j.currentStage, message });
        }
      });

      const fileSize = existsSync(absoluteOutputPath) ? statSync(absoluteOutputPath).size : 0;
      const durationMs = Date.now() - t0;
      const outputToken = store.register(absoluteOutputPath);
      const outputUrl = `${outputUrlPrefix}/${outputToken}`;
      log.info("render completed", {
        requestId,
        durationMs,
        fileSize,
        perf: job.perfSummary ?? null,
      });

      return c.json({
        success: true,
        requestId,
        outputPath: absoluteOutputPath,
        outputToken,
        outputUrl,
        fileSize,
        durationMs,
        videoDurationSeconds: job.duration ?? null,
        perf: job.perfSummary ?? null,
      });
    } catch (error) {
      const durationMs = Date.now() - t0;
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error("render failed", {
        requestId,
        durationMs,
        error: errorMsg,
        stage: job.currentStage,
      });
      return c.json(
        {
          success: false,
          requestId,
          error: errorMsg,
          stage: job.currentStage,
          durationMs,
          errorDetails: job.errorDetails ?? null,
        },
        500,
      );
    } finally {
      release();
      cleanupTempDir(cleanupProjectDir, log);
    }
  };

  const renderStream = (c: Context) => {
    return streamSSE(c, async (stream) => {
      const requestId = getRequestId(c);
      const t0 = Date.now();

      let body: Record<string, unknown>;
      try {
        body = await c.req.json();
      } catch {
        await stream.writeSSE({
          data: JSON.stringify({
            type: "error",
            requestId,
            error: "Invalid JSON body",
            stage: "validation",
          }),
        });
        return;
      }

      const preparedResult = await prepareRenderBody(body);
      if ("error" in preparedResult) {
        await stream.writeSSE({
          data: JSON.stringify({
            type: "error",
            requestId,
            error: preparedResult.error,
            stage: "validation",
          }),
        });
        return;
      }

      const { input, cleanupProjectDir, absoluteOutputPath } = resolvePreparedRenderOutput(
        preparedResult.prepared,
        rendersDir,
        log,
      );

      log.info("render-stream started", { requestId, projectDir: input.projectDir });

      const job = createRenderJob(buildRenderJobConfig(input, log));
      const abortController = new AbortController();
      const onRequestAbort = () =>
        abortController.abort(new RenderCancelledError("request_aborted"));
      c.req.raw.signal.addEventListener("abort", onRequestAbort, { once: true });

      if (renderSemaphore.activeCount >= maxConcurrentRenders) {
        await stream.writeSSE({
          data: JSON.stringify({
            type: "queued",
            requestId,
            position: renderSemaphore.waitingCount,
          }),
        });
      }
      const release = await renderSemaphore.acquire();

      try {
        await executeRenderJob(
          job,
          input.projectDir,
          absoluteOutputPath,
          async (j, message) => {
            await stream.writeSSE({
              data: JSON.stringify({
                type: "progress",
                requestId,
                stage: j.currentStage,
                progress: j.progress,
                framesRendered: j.framesRendered ?? 0,
                totalFrames: j.totalFrames ?? 0,
                message,
              }),
            });
          },
          abortController.signal,
        );

        const fileSize = existsSync(absoluteOutputPath) ? statSync(absoluteOutputPath).size : 0;
        const outputToken = store.register(absoluteOutputPath);
        const outputUrl = `${outputUrlPrefix}/${outputToken}`;
        log.info("render-stream completed", { requestId, fileSize, perf: job.perfSummary ?? null });
        await stream.writeSSE({
          data: JSON.stringify({
            type: "complete",
            requestId,
            outputPath: absoluteOutputPath,
            outputToken,
            outputUrl,
            fileSize,
            videoDurationSeconds: job.duration ?? null,
            perf: job.perfSummary ?? null,
          }),
        });
      } catch (error) {
        if (error instanceof RenderCancelledError) {
          await stream.writeSSE({
            data: JSON.stringify({
              type: "cancelled",
              requestId,
              stage: job.currentStage,
              message: error.message,
            }),
          });
          return;
        }
        const errorMsg = error instanceof Error ? error.message : String(error);
        const elapsedMs = Date.now() - t0;
        log.error("render-stream failed", {
          requestId,
          elapsedMs,
          error: errorMsg,
          stage: job.currentStage,
        });
        await stream.writeSSE({
          data: JSON.stringify({
            type: "error",
            requestId,
            error: errorMsg,
            stage: job.currentStage,
            elapsedMs,
            errorDetails: job.errorDetails ?? null,
          }),
        });
      } finally {
        release();
        c.req.raw.signal.removeEventListener("abort", onRequestAbort);
        cleanupTempDir(cleanupProjectDir, log);
      }
    });
  };

  const outputs = (c: Context): Response => {
    const token = c.req.param("token") ?? "";
    const artifact = store.get(token);
    if (!artifact) {
      return c.json({ success: false, error: "Output artifact not found or expired" }, 404);
    }
    if (!existsSync(artifact.path)) {
      store.delete(token);
      return c.json({ success: false, error: "Output artifact file missing" }, 404);
    }
    const stats = statSync(artifact.path);
    return new Response(createReadStream(artifact.path) as unknown as ReadableStream, {
      headers: {
        "content-type": "video/mp4",
        "content-length": String(stats.size),
        "cache-control": "no-store",
      },
    });
  };

  const queue = (c: Context): Response =>
    c.json({
      maxConcurrentRenders,
      activeRenders: renderSemaphore.activeCount,
      queuedRenders: renderSemaphore.waitingCount,
    });

  return { render, renderStream, lint, health, outputs, queue };
}

// ---------------------------------------------------------------------------
// Public app factory
// ---------------------------------------------------------------------------

/**
 * Create a Hono app with clean public routes for OSS use.
 */
export function createProducerApp(options: HandlerOptions = {}): Hono {
  const app = new Hono();
  const handlers = createRenderHandlers(options);

  app.get("/health", handlers.health);
  app.post("/render", handlers.render);
  app.post("/render/stream", handlers.renderStream);
  app.get("/render/queue", handlers.queue);
  app.post("/lint", handlers.lint);
  app.get("/outputs/:token", handlers.outputs);

  return app;
}

// ---------------------------------------------------------------------------
// Standalone server
// ---------------------------------------------------------------------------

/**
 * Start the producer HTTP server with graceful shutdown.
 */
export function startServer(options: ServerOptions = {}) {
  const port = options.port ?? parseInt(process.env.PRODUCER_PORT ?? "9847", 10);
  const log = options.logger ?? defaultLogger;
  const app = createProducerApp(options);

  const server = serve({ fetch: app.fetch, port }, () => {
    log.info(`Listening on http://localhost:${port}`);
  });

  // Disable timeouts for long renders
  server.setTimeout(0);
  (server as unknown as import("node:http").Server).requestTimeout = 0;
  (server as unknown as import("node:http").Server).keepAliveTimeout = 0;

  // Start the worker-thread health endpoint alongside the main listener.
  // The main thread keeps serving /health on `port` for backwards
  // compatibility; the worker thread additionally serves /health on
  // PRODUCER_HEALTH_PORT (default 9848) so k8s liveness/readiness probes can
  // migrate to a listener that doesn't share an event loop with renders.
  //
  // Opt-out: set PRODUCER_DISABLE_HEALTH_WORKER=1 (e.g. for tests that don't
  // want a worker spawned, or for environments where the extra port isn't
  // wanted).
  //
  // We store the *promise* (not the resolved handle) so a SIGTERM that
  // arrives before the worker has finished booting still has something to
  // await. Awaiting a `let healthWorker = null` mutated from inside `.then`
  // would race: if SIGTERM lands before the `.then` callback fires,
  // `shutdown()` sees `null` and skips worker cleanup. The promise pattern
  // closes that window without making startup blocking.
  const healthWorkerPromise: Promise<HealthWorkerHandle | null> =
    process.env.PRODUCER_DISABLE_HEALTH_WORKER === "1"
      ? Promise.resolve(null)
      : startHealthWorker({ logger: log }).catch((err: Error) => {
          // Don't crash the producer if the worker fails to start — the main
          // /health is still up. Log loudly so the operator notices.
          log.error(`[server] health worker failed to start: ${err.message}`);
          return null;
        });

  async function shutdown(signal: string) {
    log.info(`Received ${signal}, shutting down`);
    const { drainBrowserPool } = await import("@hyperframes/engine");
    await drainBrowserPool().catch(() => {});
    // Bounded await: if the worker hasn't come online within 1.5s of
    // shutdown there's no useful cleanup left to do — `worker.terminate()`
    // from process exit will kill the thread regardless, and we'd rather
    // not let a hung-startup worker keep the SIGTERM path waiting.
    const handle = await Promise.race<HealthWorkerHandle | null>([
      healthWorkerPromise,
      new Promise<null>((res) => setTimeout(() => res(null), 1_500).unref()),
    ]);
    if (handle) {
      await handle.shutdown().catch(() => {});
    }
    server.close(() => {
      log.info("Server closed");
      process.exit(0);
    });
    setTimeout(() => {
      log.warn("Forced exit after 30s timeout");
      process.exit(1);
    }, 30_000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  return server;
}

// ---------------------------------------------------------------------------
// Self-executable: node dist/public-server.js
// ---------------------------------------------------------------------------
// Only auto-start when this file is the explicit entry point.
// In esbuild bundles, import.meta.url is shared across inlined modules,
// so we check argv[1] against known public server filenames.
const entryScript = process.argv[1] ? resolve(process.argv[1]) : "";
const isPublicServerEntry =
  entryScript.endsWith("/public-server.js") || entryScript.endsWith("/src/server.ts");

if (isPublicServerEntry) {
  const { values } = parseArgs({
    options: {
      port: { type: "string", short: "p", default: process.env.PRODUCER_PORT ?? "9847" },
    },
  });
  startServer({ port: parseInt(values.port as string, 10) });
}
