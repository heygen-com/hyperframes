/**
 * Embedded studio server for `hyperframes preview` outside the monorepo.
 *
 * Uses the shared studio API module from @hyperframes/core/studio-api,
 * providing a CLI-specific adapter for single-project, in-process rendering.
 */

import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { existsSync, readFileSync, writeFileSync, statSync, unlinkSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { createProjectWatcher, type ProjectWatcher } from "./fileWatcher.js";
import {
  hashSignatureParts,
  loadRuntimeSource,
  loadRuntimeSourceSignature,
} from "./runtimeSource.js";
import { VERSION as version } from "../version.js";
import { buildStudioHeadScripts, resolveCliTelemetryDistinctId } from "./telemetryIdentity.js";
import { emitStudioRenderComplete, emitStudioRenderError } from "./studioRenderTelemetry.js";
import { isDevMode } from "../utils/env.js";
import {
  createStudioManualEditsRenderBodyScript,
  createStudioApi,
  createProjectSignature,
  createBackgroundRemovalJob,
  getMimeType,
  type StudioApiAdapter,
  type ResolvedProject,
  type RenderJobState,
  type BackgroundRemovalRender,
} from "@hyperframes/studio-server";
import { getElementScreenshotClip } from "@hyperframes/studio-server/screenshot-clip";
import type { ScreenshotClip } from "@hyperframes/studio-server/screenshot-clip";
import type { RenderJob } from "@hyperframes/producer";

const STUDIO_MANUAL_EDITS_PATH = ".hyperframes/studio-manual-edits.json";
const REMOTE_GIF_IMG_SRC_RE =
  /<img\b[^>]*?\bsrc\s*=\s*["'](https?:\/\/[^"']+\.gif(?:[?#][^"']*)?)["'][^>]*>/gi;

async function loadStudioProducer() {
  return isDevMode()
    ? await import("../../../producer/src/index.js")
    : await import("@hyperframes/producer");
}

// ── Path resolution ─────────────────────────────────────────────────────────

function resolveDistDir(): string {
  return resolveStudioBundle().dir;
}

export interface StudioBundleResolution {
  dir: string;
  indexPath: string;
  available: boolean;
  checkedPaths: string[];
}

export function resolveStudioBundle(): StudioBundleResolution {
  const builtPath = resolve(__dirname, "studio");
  const builtIndex = resolve(builtPath, "index.html");
  if (existsSync(builtIndex)) {
    return { dir: builtPath, indexPath: builtIndex, available: true, checkedPaths: [builtIndex] };
  }
  const devPath = resolve(__dirname, "..", "..", "..", "studio", "dist");
  const devIndex = resolve(devPath, "index.html");
  if (existsSync(devIndex)) {
    return {
      dir: devPath,
      indexPath: devIndex,
      available: true,
      checkedPaths: [builtIndex, devIndex],
    };
  }
  return {
    dir: builtPath,
    indexPath: builtIndex,
    available: false,
    checkedPaths: [builtIndex, devIndex],
  };
}

function resolveRuntimePath(): string {
  const builtPath = resolve(__dirname, "hyperframe-runtime.js");
  if (existsSync(builtPath)) return builtPath;
  const iifePath = resolve(__dirname, "hyperframe.runtime.iife.js");
  if (existsSync(iifePath)) return iifePath;
  const devPath = resolve(
    __dirname,
    "..",
    "..",
    "..",
    "core",
    "dist",
    "hyperframe.runtime.iife.js",
  );
  if (existsSync(devPath)) return devPath;
  return builtPath;
}

function readStudioManualEditManifestContent(projectDir: string): string {
  const manifestPath = join(projectDir, STUDIO_MANUAL_EDITS_PATH);
  if (!existsSync(manifestPath)) return "";
  try {
    return readFileSync(manifestPath, "utf-8");
  } catch {
    return "";
  }
}

async function applyStudioManualEditsToThumbnailPage(
  page: import("puppeteer-core").Page,
  manifestContent: string,
  activeCompositionPath: string,
): Promise<void> {
  const script = createStudioManualEditsRenderBodyScript(manifestContent, {
    activeCompositionPath,
  });
  if (!script) return;
  await page.addScriptTag({ content: script });
}

async function reapplyStudioManualEditsToThumbnailPage(
  page: import("puppeteer-core").Page,
): Promise<void> {
  await page.evaluate(() => {
    const apply = (window as Window & { __hfStudioManualEditsApply?: () => number })
      .__hfStudioManualEditsApply;
    if (typeof apply === "function") apply();
  });
}

function collectRemoteGifImageSources(html: string): string[] {
  const urls = new Set<string>();
  const re = new RegExp(REMOTE_GIF_IMG_SRC_RE.source, REMOTE_GIF_IMG_SRC_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    if (match[1]) urls.add(match[1]);
  }
  return [...urls];
}

async function downloadRemoteGifImageSources(
  html: string,
  downloadDir: string,
  downloadToTemp: (url: string, destDir: string) => Promise<string>,
): Promise<Map<string, string>> {
  const sourceAssets = new Map<string, string>();
  await Promise.all(
    collectRemoteGifImageSources(html).map(async (url) => {
      try {
        sourceAssets.set(url, await downloadToTemp(url, downloadDir));
      } catch (err) {
        console.warn(
          "[Studio] Remote animated GIF prep skipped:",
          err instanceof Error ? err.message : err,
        );
      }
    }),
  );
  return sourceAssets;
}

// ── Shared thumbnail browser (pool-backed) ──────────────────────────────────
// Uses the engine's browser pool so the thumbnail browser and render workers
// share a single Chrome process instead of running two independent ones.

let _thumbnailBrowser: import("puppeteer-core").Browser | null = null;
let _thumbnailBrowserInitializing: Promise<import("puppeteer-core").Browser | null> | null = null;

async function getThumbnailBrowser(): Promise<import("puppeteer-core").Browser | null> {
  if (_thumbnailBrowser?.connected) return _thumbnailBrowser;
  if (_thumbnailBrowserInitializing) return _thumbnailBrowserInitializing;

  _thumbnailBrowserInitializing = (async () => {
    try {
      const { ensureBrowser } = await import("../browser/manager.js");
      const { acquireBrowser, buildChromeArgs } = await import("@hyperframes/engine");

      try {
        const b = await ensureBrowser({ preferManagedChrome: true });
        if (b.executablePath && !process.env.PRODUCER_HEADLESS_SHELL_PATH) {
          process.env.PRODUCER_HEADLESS_SHELL_PATH = b.executablePath;
        }
      } catch {
        /* continue — acquireBrowser will try its own resolution */
      }

      const acquired = await acquireBrowser(
        buildChromeArgs({ width: 1920, height: 1080, captureMode: "screenshot" }),
        { forceScreenshot: true },
      );
      _thumbnailBrowser = acquired.browser;
      _thumbnailBrowser.on("disconnected", () => {
        _thumbnailBrowser = null;
        _thumbnailBrowserInitializing = null;
      });
      return _thumbnailBrowser;
    } catch (err) {
      console.warn(
        "[Studio] Failed to launch thumbnail browser:",
        err instanceof Error ? err.message : err,
      );
      _thumbnailBrowserInitializing = null;
      return null;
    }
  })();

  return _thumbnailBrowserInitializing;
}

export async function closeThumbnailBrowser(): Promise<void> {
  if (!_thumbnailBrowser) return;
  const browser = _thumbnailBrowser;
  _thumbnailBrowser = null;
  _thumbnailBrowserInitializing = null;
  const { releaseBrowser } = await import("@hyperframes/engine");
  await releaseBrowser(browser).catch(() => {});
}

// ── Server factory ──────────────────────────────────────────────────────────

export interface StudioServerOptions {
  projectDir: string;
  /** Display name for the project. Defaults to basename of projectDir. */
  projectName?: string;
}

export interface StudioServer {
  app: Hono;
  watcher: ProjectWatcher;
}

export async function loadPreviewServerBuildSignature(): Promise<string> {
  const runtimeSignature = await loadRuntimeSourceSignature();
  const studioBundle = resolveStudioBundle();
  const studioIndex =
    studioBundle.available && existsSync(studioBundle.indexPath)
      ? readFileSync(studioBundle.indexPath, "utf-8")
      : "";
  return hashSignatureParts([
    version,
    runtimeSignature,
    studioIndex,
    createStudioServer.toString(),
    createStudioApi.toString(),
    createProjectSignature.toString(),
    getMimeType.toString(),
    getElementScreenshotClip.toString(),
  ]);
}

// Rewrite the viewport meta + inline width/height in every written .html to the
// host composition's dimensions, so an installed fragment matches the host
// canvas. Applies to ALL written files — including any .html a dependency ships,
// not just the requested block's — which is intentional. No-op when the host
// index.html is absent or carries no dimensions.
function rewriteWrittenToHostViewport(projectDir: string, written: string[]): void {
  const indexPath = join(projectDir, "index.html");
  if (!existsSync(indexPath)) return;
  const indexHtml = readFileSync(indexPath, "utf-8");
  const hostW = indexHtml.match(/data-width="(\d+)"/)?.[1];
  const hostH = indexHtml.match(/data-height="(\d+)"/)?.[1];
  if (!hostW || !hostH) return;

  for (const absPath of written) {
    if (!absPath.endsWith(".html")) continue;
    let content = readFileSync(absPath, "utf-8");
    content = content.replace(
      /(<meta\s+name="viewport"\s+content="width=)\d+(,\s*height=)\d+/i,
      `$1${hostW}$2${hostH}`,
    );
    content = content.replace(
      /(\bwidth:\s*)\d+(px;\s*\n?\s*height:\s*)\d+(px;)/g,
      (match, pre, mid, post) => {
        if (match.includes("1920") || match.includes("1080")) {
          return `${pre}${hostW}${mid}${hostH}${post}`;
        }
        return match;
      },
    );
    writeFileSync(absPath, content, "utf-8");
  }
}

export function createStudioServer(options: StudioServerOptions): StudioServer {
  const { projectDir, projectName } = options;
  const projectId = projectName || basename(projectDir);
  const studioDir = resolveDistDir();
  const runtimePath = resolveRuntimePath();
  const watcher = createProjectWatcher(projectDir);

  // ── CLI adapter for the shared studio API ──────────────────────────────

  const project: ResolvedProject = { id: projectId, dir: projectDir, title: projectId };
  let cachedProjectSignature: string | null = null;
  watcher.addListener(() => {
    cachedProjectSignature = null;
  });

  const adapter: StudioApiAdapter = {
    listProjects: () => [project],

    resolveProject: (id: string) => (id === projectId ? project : null),

    async bundle(dir: string): Promise<string | null> {
      try {
        const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");
        // Studio dev server: ask the bundler for an empty `src=""` placeholder so
        // we can point it at our hot-reloadable local runtime endpoint. Inlining
        // ~150 KB of runtime body on every preview render would defeat browser
        // caching across composition edits.
        let html = await bundleToSingleHtml(dir, {
          runtime: "placeholder",
          inlineColorGradingLuts: false,
        });
        html = html.replace(
          'data-hyperframes-preview-runtime="1" src=""',
          'data-hyperframes-preview-runtime="1" src="/api/runtime.js"',
        );
        return html;
      } catch (err) {
        console.error("[studio] Bundle failed:", err);
        return null;
      }
    },

    async transformPreviewHtml({ html, project }) {
      const { injectDeterministicFontFaces } =
        await import("../../../producer/src/services/deterministicFonts.js");
      const { prepareAnimatedGifInputs } =
        await import("../../../producer/src/services/animatedGifPrep.js");
      const { downloadToTemp } = await import("../../../producer/src/utils/urlDownloader.js");
      const gifOutputDir = join(project.dir, ".hyperframes", "prepared-assets", "gif");
      const gifDownloadDir = join(project.dir, ".hyperframes", "prepared-assets", "downloads");
      const prepared = await prepareAnimatedGifInputs(html, {
        projectDir: project.dir,
        downloadDir: gifDownloadDir,
        outputDir: gifOutputDir,
        outputSrcPrefix: ".hyperframes/prepared-assets/gif",
        cacheDir: gifOutputDir,
        sourceAssets: await downloadRemoteGifImageSources(html, gifDownloadDir, downloadToTemp),
      });
      return injectDeterministicFontFaces(prepared.html);
    },

    getProjectSignature(dir: string): string {
      if (resolve(dir) !== resolve(projectDir)) return createProjectSignature(dir);
      cachedProjectSignature ??= createProjectSignature(projectDir);
      return cachedProjectSignature;
    },

    async lint(html: string, opts?: { filePath?: string }) {
      const { lintHyperframeHtml } = await import("@hyperframes/lint");
      return await lintHyperframeHtml(html, opts);
    },

    runtimeUrl: "/api/runtime.js",

    rendersDir: () => join(projectDir, "renders"),

    startRender(opts): RenderJobState {
      const abortController = new AbortController();
      const state: RenderJobState = {
        id: opts.jobId,
        status: "rendering",
        progress: 0,
        outputPath: opts.outputPath,
        cancel: () => abortController.abort(),
      };

      // Run render asynchronously, mutating the state object
      const startTime = Date.now();
      (async () => {
        let renderJob: RenderJob | undefined;
        const removeCancelledOutput = () => {
          // User-initiated cancel: not a failure. Remove any output so the
          // cancelled job doesn't resurrect in the render history.
          state.status = "cancelled";
          for (const suffix of ["", ".meta.json"]) {
            const fp = suffix
              ? opts.outputPath.replace(/\.(mp4|webm|mov)$/, suffix)
              : opts.outputPath;
            try {
              if (existsSync(fp)) unlinkSync(fp);
            } catch {
              /* ignore */
            }
          }
        };
        try {
          const { createRenderJob, executeRenderJob } = await loadStudioProducer();
          const { ensureBrowser } = await import("../browser/manager.js");

          try {
            const browser = await ensureBrowser({ preferManagedChrome: true });
            if (browser.executablePath && !process.env.PRODUCER_HEADLESS_SHELL_PATH) {
              process.env.PRODUCER_HEADLESS_SHELL_PATH = browser.executablePath;
            }
          } catch {
            // Continue without — acquireBrowser will try its own resolution
          }

          const manifestContent = readStudioManualEditManifestContent(opts.project.dir);
          const manualEditsRenderScript = createStudioManualEditsRenderBodyScript(manifestContent);
          const job = createRenderJob({
            // opts.fps is already an Fps rational — see vite-config-studio
            // adapter for the same convention.
            fps: opts.fps,
            quality: opts.quality as "draft" | "standard" | "high",
            format: opts.format,
            outputResolution: opts.outputResolution,
            ...(manualEditsRenderScript ? { renderBodyScripts: [manualEditsRenderScript] } : {}),
            ...(opts.composition ? { entryFile: opts.composition } : {}),
            ...(opts.variables ? { variables: opts.variables } : {}),
          });
          renderJob = job;
          const onProgress = (j: { progress: number; currentStage?: string }) => {
            state.progress = j.progress;
            if (j.currentStage) state.stage = j.currentStage;
          };
          await executeRenderJob(
            job,
            opts.project.dir,
            opts.outputPath,
            onProgress,
            abortController.signal,
          );
          if (abortController.signal.aborted) {
            // Cancel landed just as the render finished: honor the cancel the
            // route already reported instead of resurrecting a completed job.
            removeCancelledOutput();
            return;
          }
          state.status = "complete";
          state.progress = 100;
          const metaPath = opts.outputPath.replace(/\.(mp4|webm|mov)$/, ".meta.json");
          writeFileSync(
            metaPath,
            JSON.stringify({ status: "complete", durationMs: Date.now() - startTime }),
          );
          emitStudioRenderComplete(opts, Date.now() - startTime, job.perfSummary);
        } catch (err) {
          if (abortController.signal.aborted) {
            removeCancelledOutput();
            return;
          }
          state.status = "failed";
          state.error = err instanceof Error ? err.message : String(err);
          // fallow-ignore-next-line code-duplication
          emitStudioRenderError(opts, Date.now() - startTime, state.stage, err, renderJob);
          try {
            const metaPath = opts.outputPath.replace(/\.(mp4|webm|mov)$/, ".meta.json");
            writeFileSync(metaPath, JSON.stringify({ status: "failed" }));
          } catch {
            /* ignore */
          }
        }
      })();

      return state;
    },

    startBackgroundRemoval(opts) {
      return createBackgroundRemovalJob(opts, async (renderOpts) => {
        const sourcePipelinePath = "../background-removal/pipeline.ts";
        const pipeline = (await import("../background-removal/pipeline.js").catch(
          () => import(sourcePipelinePath),
        )) as { render: BackgroundRemovalRender };
        return pipeline.render(renderOpts);
      });
    },

    async generateThumbnail(opts): Promise<Buffer | null> {
      const browser = await getThumbnailBrowser();
      if (!browser) {
        console.warn("[Studio] Thumbnail: no browser available — Chrome may not be installed");
        return null;
      }
      let page: import("puppeteer-core").Page | null = null;
      try {
        page = await browser.newPage();
        await page.setViewport({ width: opts.width || 1920, height: opts.height || 1080 });
        await page.goto(opts.previewUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
        await page
          .waitForFunction(
            () => {
              const w = window as Window & {
                __timelines?: Record<string, unknown>;
              };
              return !!(w.__timelines && Object.keys(w.__timelines).length > 0);
            },
            { timeout: 5000 },
          )
          .catch(() => {});
        // fallow-ignore-next-line code-duplication
        await page.evaluate((t: number) => {
          const w = window as Window & {
            __player?: { seek?: (time: number) => void };
            __timelines?: Record<string, { pause?: (time?: number) => void }>;
            gsap?: { ticker?: { tick?: () => void } };
          };
          if (typeof w.__player?.seek === "function") {
            w.__player.seek(t);
          } else if (w.__timelines) {
            for (const tl of Object.values(w.__timelines)) {
              tl?.pause?.(t);
            }
            w.gsap?.ticker?.tick?.();
          }
        }, opts.seekTime);
        const manifestContent = readStudioManualEditManifestContent(opts.project.dir);
        await applyStudioManualEditsToThumbnailPage(page, manifestContent, opts.compPath);
        await page.evaluate(() => {
          void document.fonts?.ready;
          const body = document.body;
          if (body && getComputedStyle(body).backgroundColor === "rgba(0, 0, 0, 0)") {
            body.style.backgroundColor = "#1c2028";
          }
        });
        await new Promise((r) => setTimeout(r, 200));
        await reapplyStudioManualEditsToThumbnailPage(page);
        let clip: ScreenshotClip | undefined;
        if (opts.selector) {
          clip = await page.evaluate(getElementScreenshotClip, opts.selector, opts.selectorIndex);
        }
        const screenshot = (await page.screenshot(
          opts.format === "png"
            ? {
                type: "png",
                ...(clip ? { clip } : {}),
              }
            : {
                type: "jpeg",
                quality: 80,
                ...(clip ? { clip } : {}),
              },
        )) as Buffer;
        return screenshot;
      } catch (err) {
        console.warn(
          "[Studio] Thumbnail generation failed:",
          err instanceof Error ? err.message : err,
        );
        return null;
      } finally {
        await page?.close().catch(() => {});
      }
    },

    async listRegistryCatalog() {
      const { listRegistryItems, loadAllItems } = await import("../registry/resolver.js");
      const entries = await listRegistryItems();
      const blockAndComponentEntries = entries.filter(
        (e) => e.type === "hyperframes:block" || e.type === "hyperframes:component",
      );
      return loadAllItems(blockAndComponentEntries);
    },

    async installRegistryBlock(opts) {
      const { resolveItemWithDependencies } = await import("../registry/resolver.js");
      const { installItem } = await import("../registry/installer.js");
      const { gateRegistryItemsCompatibility } = await import("../registry/compatibility.js");
      // Resolve transitive registryDependencies and install them first so a
      // block that depends on other registry items installs completely.
      const items = await resolveItemWithDependencies(opts.blockName);
      // Compatibility-gate the whole set before writing anything (same gate as
      // `hyperframes add`), so an incompatible block or dep aborts cleanly.
      const warnings = gateRegistryItemsCompatibility(items);
      for (const warning of warnings) {
        process.stderr.write(`hyperframes:registry ${warning}\n`);
      }
      const written: string[] = [];
      for (const dep of items) {
        const result = await installItem(dep, { destDir: opts.project.dir });
        written.push(...result.written);
      }
      const item = items[items.length - 1]!;

      rewriteWrittenToHostViewport(opts.project.dir, written);

      const relativePaths = written.map((abs) => {
        const rel = abs.startsWith(opts.project.dir) ? abs.slice(opts.project.dir.length + 1) : abs;
        return rel;
      });
      return { written: relativePaths, block: item };
    },
  };

  // ── Build the Hono app ─────────────────────────────────────────────────

  const app = new Hono();

  // Config probe endpoint — used by port detection to identify existing
  // HyperFrames instances and reuse them instead of spawning duplicates.
  // See portUtils.ts detectHyperframesServer() for the consumer.
  app.get("/__hyperframes_config", (c) => {
    const serve = async () => {
      const serverBuildSignature = await loadPreviewServerBuildSignature();
      return c.json({
        isHyperframes: true,
        projectName: projectId,
        projectDir: projectDir,
        serverBuildSignature,
        version,
      });
    };
    return serve();
  });

  // CLI-specific routes (before shared API)
  app.get("/api/runtime.js", (c) => {
    const serve = async () => {
      const runtimeSource =
        (await loadRuntimeSource()) ??
        (existsSync(runtimePath) ? readFileSync(runtimePath, "utf-8") : null);
      if (!runtimeSource) return c.text("runtime not available", 404);
      return c.body(runtimeSource, 200, {
        "Content-Type": "text/javascript",
        "Cache-Control": "no-store",
      });
    };
    return serve();
  });

  // CLI → Studio telemetry identity endpoint (Layer 1). Studio reads the
  // injected `window.__HF_CLI_DISTINCT_ID` first; this GET is a fallback for
  // clients that can't rely on the injected global. Returns the CLI's anonymous
  // distinct id (no PII) so the browser session can join the CLI's PostHog
  // person, or `{ distinctId: null }` when CLI telemetry is disabled.
  app.get("/api/telemetry-identity", (c) => {
    return c.json({ distinctId: resolveCliTelemetryDistinctId() });
  });

  app.get("/api/events", (c) => {
    return streamSSE(c, async (stream) => {
      const listener = (path: string) => {
        stream.writeSSE({ event: "file-change", data: JSON.stringify({ path }) }).catch(() => {});
      };
      watcher.addListener(listener);
      while (true) {
        await stream.sleep(30000);
      }
    });
  });

  // ── Pre-flight checks for render ────────────────────────────────────────
  // Intercept render requests before they reach the shared API so we can
  // fail fast with an actionable hint instead of burning through the entire
  // capture pipeline before hitting "spawn ffmpeg ENOENT" at encode.
  let cachedFFmpegPath: string | undefined;
  app.post("/api/projects/:id/render", async (c, next) => {
    const { findFFmpeg, getFFmpegInstallHint } = await import("../browser/ffmpeg.js");
    if (!cachedFFmpegPath) {
      cachedFFmpegPath = findFFmpeg();
    }
    if (!cachedFFmpegPath) {
      return c.json({ error: "FFmpeg not found", hint: getFFmpegInstallHint() }, 503);
    }
    return next();
  });

  // Mount the shared studio API at /api.
  // Use fetch() forwarding (not .route()) so the sub-app sees paths without
  // the /api prefix — the shared module's path extraction uses c.req.path.
  const api = createStudioApi(adapter);
  app.all("/api/*", async (c) => {
    const url = new URL(c.req.url);
    url.pathname = url.pathname.slice(4); // Strip "/api" prefix
    const forwardReq = new Request(url.toString(), {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: c.req.raw.body,
      // @ts-expect-error -- Node needs duplex for streaming bodies
      duplex: "half",
    });
    return api.fetch(forwardReq);
  });

  // Studio SPA static files
  const serveStudioStaticFile = (c: Context) => {
    const filePath = resolve(studioDir, c.req.path.slice(1));
    if (!existsSync(filePath) || !statSync(filePath).isFile()) return c.text("not found", 404);
    const content = readFileSync(filePath);
    return new Response(content, {
      headers: { "Content-Type": getMimeType(filePath), "Cache-Control": "no-store" },
    });
  };
  app.get("/assets/*", serveStudioStaticFile);
  app.get("/icons/*", serveStudioStaticFile);
  app.get("/favicon.svg", serveStudioStaticFile);

  // ── Runtime env injection ───────────────────────────────────────────────
  // When the studio is served as a pre-built SPA, Vite `VITE_STUDIO_*` env
  // vars were baked at build time. Collect any such vars from the current
  // process.env and inject them as `window.__HF_STUDIO_ENV__` so the client
  // can pick them up at runtime, overriding the baked defaults.
  function buildRuntimeEnvScript(): string {
    const overrides: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith("VITE_STUDIO_") && value !== undefined) {
        overrides[key] = value;
      }
    }
    if (Object.keys(overrides).length === 0) return "";
    return `<script>window.__HF_STUDIO_ENV__=${JSON.stringify(overrides)};</script>`;
  }

  // SPA fallback
  app.get("*", (c) => {
    const indexPath = resolve(studioDir, "index.html");
    if (!existsSync(indexPath)) {
      return c.html(
        `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>HyperFrames Studio unavailable</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0d0f14;
        color: #eef2f7;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        width: min(560px, calc(100vw - 48px));
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 8px;
        padding: 28px;
        background: #151923;
      }
      h1 {
        margin: 0 0 12px;
        font-size: 22px;
        line-height: 1.2;
      }
      p {
        margin: 0 0 18px;
        color: #aab3c2;
        line-height: 1.5;
      }
      code {
        display: block;
        padding: 12px 14px;
        border-radius: 6px;
        background: #090b10;
        color: #8ff0c2;
        overflow-wrap: anywhere;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Studio bundle missing</h1>
      <p>The preview server started, but this CLI build does not contain the Studio assets.</p>
      <code>bun run build</code>
    </main>
  </body>
</html>`,
        500,
      );
    }
    let html = readFileSync(indexPath, "utf-8");
    // Inject before the studio bundle runs. Identity script first (see
    // buildStudioHeadScripts) so the CLI distinct id is on `window` by the time
    // telemetry init reads it.
    const headScript = buildStudioHeadScripts(buildRuntimeEnvScript());
    if (headScript) {
      html = html.replace("<head>", `<head>${headScript}`);
    }
    return c.html(html);
  });

  return { app, watcher };
}
