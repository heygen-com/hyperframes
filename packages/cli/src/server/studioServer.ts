/**
 * Embedded studio server for `hyperframes preview` outside the monorepo.
 *
 * Uses the shared studio API module from @hyperframes/core/studio-api,
 * providing a CLI-specific adapter for single-project, in-process rendering.
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { createProjectWatcher, type ProjectWatcher } from "./fileWatcher.js";
import {
  createStudioApi,
  getMimeType,
  type StudioApiAdapter,
  type ResolvedProject,
  type RenderJobState,
} from "@hyperframes/core/studio-api";

// ── Path resolution ─────────────────────────────────────────────────────────

function resolveDistDir(): string {
  const builtPath = resolve(__dirname, "studio");
  if (existsSync(resolve(builtPath, "index.html"))) return builtPath;
  const devPath = resolve(__dirname, "..", "..", "..", "studio", "dist");
  if (existsSync(resolve(devPath, "index.html"))) return devPath;
  return builtPath;
}

function resolveRuntimePath(): string {
  const builtPath = resolve(__dirname, "hyperframe-runtime.js");
  if (existsSync(builtPath)) return builtPath;
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

// ── Shared thumbnail browser (singleton per process) ────────────────────────
// One browser instance is reused across all composition thumbnail requests.
// Spawning a new Puppeteer process per request adds 2-5s overhead and causes
// contention when the sidebar requests multiple thumbnails simultaneously.

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
        const b = await ensureBrowser();
        if (b.executablePath && !process.env.PRODUCER_HEADLESS_SHELL_PATH) {
          process.env.PRODUCER_HEADLESS_SHELL_PATH = b.executablePath;
        }
      } catch {
        /* continue — acquireBrowser will try its own resolution */
      }

      const acquired = await acquireBrowser(buildChromeArgs({ width: 1920, height: 1080 }), {
        enableBrowserPool: false,
      });
      _thumbnailBrowser = acquired.browser;
      _thumbnailBrowser.on("disconnected", () => {
        _thumbnailBrowser = null;
        _thumbnailBrowserInitializing = null;
      });
      return _thumbnailBrowser;
    } catch {
      _thumbnailBrowserInitializing = null;
      return null;
    }
  })();

  return _thumbnailBrowserInitializing;
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

export function createStudioServer(options: StudioServerOptions): StudioServer {
  const { projectDir, projectName } = options;
  const projectId = projectName || basename(projectDir);
  const studioDir = resolveDistDir();
  const runtimePath = resolveRuntimePath();
  const watcher = createProjectWatcher(projectDir);

  // ── CLI adapter for the shared studio API ──────────────────────────────

  const project: ResolvedProject = { id: projectId, dir: projectDir, title: projectId };

  const adapter: StudioApiAdapter = {
    listProjects: () => [project],

    resolveProject: (id: string) => (id === projectId ? project : null),

    async bundle(dir: string): Promise<string | null> {
      try {
        const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");
        let html = await bundleToSingleHtml(dir);
        // Fix empty runtime src from bundler — point to the local runtime endpoint
        html = html.replace(
          'data-hyperframes-preview-runtime="1" src=""',
          'data-hyperframes-preview-runtime="1" src="/api/runtime.js"',
        );
        return html;
      } catch {
        return null;
      }
    },

    async lint(html: string, opts?: { filePath?: string }) {
      const { lintHyperframeHtml } = await import("@hyperframes/core/lint");
      return lintHyperframeHtml(html, opts);
    },

    runtimeUrl: "/api/runtime.js",

    rendersDir: () => join(projectDir, "renders"),

    startRender(opts): RenderJobState {
      const state: RenderJobState = {
        id: opts.jobId,
        status: "rendering",
        progress: 0,
        outputPath: opts.outputPath,
      };

      // Run render asynchronously, mutating the state object
      (async () => {
        try {
          const { createRenderJob, executeRenderJob } = await import("@hyperframes/producer");
          const { ensureBrowser } = await import("../browser/manager.js");

          try {
            const browser = await ensureBrowser();
            if (browser.executablePath && !process.env.PRODUCER_HEADLESS_SHELL_PATH) {
              process.env.PRODUCER_HEADLESS_SHELL_PATH = browser.executablePath;
            }
          } catch {
            // Continue without — acquireBrowser will try its own resolution
          }

          const job = createRenderJob({
            fps: opts.fps as 24 | 30 | 60,
            quality: opts.quality as "draft" | "standard" | "high",
            format: opts.format,
          });
          const startTime = Date.now();
          const onProgress = (j: { progress: number; currentStage?: string }) => {
            state.progress = j.progress;
            if (j.currentStage) state.stage = j.currentStage;
          };
          await executeRenderJob(job, opts.project.dir, opts.outputPath, onProgress);
          state.status = "complete";
          state.progress = 100;
          const metaPath = opts.outputPath.replace(/\.(mp4|webm)$/, ".meta.json");
          writeFileSync(
            metaPath,
            JSON.stringify({ status: "complete", durationMs: Date.now() - startTime }),
          );
        } catch (err) {
          state.status = "failed";
          state.error = err instanceof Error ? err.message : String(err);
          try {
            const metaPath = opts.outputPath.replace(/\.(mp4|webm)$/, ".meta.json");
            writeFileSync(metaPath, JSON.stringify({ status: "failed" }));
          } catch {
            /* ignore */
          }
        }
      })();

      return state;
    },

    async generateThumbnail(opts): Promise<Buffer | null> {
      // Reuse a single browser across all thumbnail requests for this server
      // instance — avoids paying the ~2s Puppeteer startup cost per composition.
      // The browser is created lazily and kept alive until the process exits.
      const browser = await getThumbnailBrowser();
      if (!browser) return null;
      let page: import("puppeteer-core").Page | null = null;
      try {
        page = await browser.newPage();
        await page.setViewport({ width: opts.width || 1920, height: opts.height || 1080 });
        // domcontentloaded instead of networkidle2 — CDN scripts (GSAP, Lottie,
        // fonts) never reach "idle" and cause a 15s timeout per thumbnail.
        await page.goto(opts.previewUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
        // Wait for the runtime to register timelines (up to 5s, non-fatal).
        await page
          .waitForFunction(() => !!(window as any).__timelines || !!(window as any).__playerReady, {
            timeout: 5000,
          })
          .catch(() => {});
        await page.evaluate((t: number) => {
          const win = window as any;
          if (win.__player?.seek) win.__player.seek(t);
          else if (win.__timeline?.seek) {
            win.__timeline.pause();
            win.__timeline.seek(t);
          }
        }, opts.seekTime);
        // Let the seek render settle.
        await new Promise((r) => setTimeout(r, 200));
        const screenshot = (await page.screenshot({ type: "jpeg", quality: 80 })) as Buffer;
        return screenshot;
      } catch {
        return null;
      } finally {
        await page?.close().catch(() => {});
      }
    },
  };

  // ── Build the Hono app ─────────────────────────────────────────────────

  const app = new Hono();

  // CLI-specific routes (before shared API)
  app.get("/api/runtime.js", (c) => {
    if (!existsSync(runtimePath)) return c.text("runtime not built", 404);
    return c.body(readFileSync(runtimePath, "utf-8"), 200, {
      "Content-Type": "text/javascript",
      "Cache-Control": "no-store",
    });
  });

  app.get("/api/events", (c) => {
    return streamSSE(c, async (stream) => {
      const listener = () => {
        stream.writeSSE({ event: "file-change", data: "{}" }).catch(() => {});
      };
      watcher.addListener(listener);
      while (true) {
        await stream.sleep(30000);
      }
    });
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
  app.get("/assets/*", (c) => {
    const filePath = resolve(studioDir, c.req.path.slice(1));
    if (!existsSync(filePath) || !statSync(filePath).isFile()) return c.text("not found", 404);
    const content = readFileSync(filePath);
    return new Response(content, {
      headers: { "Content-Type": getMimeType(filePath), "Cache-Control": "no-store" },
    });
  });

  app.get("/icons/*", (c) => {
    const filePath = resolve(studioDir, c.req.path.slice(1));
    if (!existsSync(filePath) || !statSync(filePath).isFile()) return c.text("not found", 404);
    const content = readFileSync(filePath);
    return new Response(content, {
      headers: { "Content-Type": getMimeType(filePath), "Cache-Control": "no-store" },
    });
  });

  // SPA fallback
  app.get("*", (c) => {
    const indexPath = resolve(studioDir, "index.html");
    if (!existsSync(indexPath)) {
      return c.text("Studio not found. Rebuild with: pnpm run build", 500);
    }
    return c.html(readFileSync(indexPath, "utf-8"));
  });

  return { app, watcher };
}
