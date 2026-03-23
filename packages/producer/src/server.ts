#!/usr/bin/env node
/**
 * @hyperframes/producer — Public Server
 *
 * Clean HTTP API for rendering HTML compositions to video.
 *
 * Routes:
 *   POST /render         — blocking render, returns JSON
 *   POST /render/stream  — SSE streaming render with progress
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
} from "./services/renderOrchestrator.js";
import { prepareHyperframeLintBody, runHyperframeLint } from "./services/hyperframeLint.js";
import { resolveRenderPaths } from "./utils/paths.js";
import { defaultLogger, type ProducerLogger } from "./logger.js";

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
  fps: 24 | 30 | 60;
  quality: "draft" | "standard" | "high";
  workers?: number;
  useGpu: boolean;
  debug: boolean;
}

interface PreparedRenderInput {
  input: RenderInput;
  cleanupProjectDir?: string;
}

function parseRenderOptions(body: Record<string, unknown>): Omit<RenderInput, "projectDir"> {
  const fps = ([24, 30, 60].includes(body.fps as number) ? body.fps : 30) as 24 | 30 | 60;
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

  return { outputPath, fps, quality, workers, useGpu, debug };
}

async function prepareRenderBody(
  body: Record<string, unknown>,
): Promise<{ prepared: PreparedRenderInput } | { error: string }> {
  const options = parseRenderOptions(body);
  const projectDir = typeof body.projectDir === "string" ? body.projectDir : undefined;
  if (projectDir) {
    const absProjectDir = resolve(projectDir);
    if (!existsSync(absProjectDir) || !statSync(absProjectDir).isDirectory()) {
      return { error: `Project directory not found: ${absProjectDir}` };
    }
    if (!existsSync(resolve(absProjectDir, "index.html"))) {
      return { error: `No index.html in project directory: ${absProjectDir}` };
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

    const result = runHyperframeLint(preparedResult.prepared);
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

    const { input, cleanupProjectDir } = preparedResult.prepared;
    const absoluteOutputPath = resolveOutputPath(
      input.projectDir,
      input.outputPath,
      rendersDir,
      log,
    );
    const outputDir = dirname(absoluteOutputPath);
    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

    log.info("render started", {
      requestId,
      projectDir: input.projectDir,
      fps: input.fps,
      quality: input.quality,
    });

    const job = createRenderJob({
      fps: input.fps,
      quality: input.quality,
      workers: input.workers,
      useGpu: input.useGpu,
      debug: input.debug,
      logger: log,
    });

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

      const { input, cleanupProjectDir } = preparedResult.prepared;
      const absoluteOutputPath = resolveOutputPath(
        input.projectDir,
        input.outputPath,
        rendersDir,
        log,
      );
      const outputDir = dirname(absoluteOutputPath);
      if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

      log.info("render-stream started", { requestId, projectDir: input.projectDir });

      const job = createRenderJob({
        fps: input.fps,
        quality: input.quality,
        workers: input.workers,
        useGpu: input.useGpu,
        debug: input.debug,
        logger: log,
      });
      const abortController = new AbortController();
      const onRequestAbort = () =>
        abortController.abort(new RenderCancelledError("request_aborted"));
      c.req.raw.signal.addEventListener("abort", onRequestAbort, { once: true });

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

  return { render, renderStream, lint, health, outputs };
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

  function shutdown(signal: string) {
    log.info(`Received ${signal}, shutting down`);
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
