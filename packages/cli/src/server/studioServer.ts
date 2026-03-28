/**
 * Embedded studio server for `hyperframes dev` outside the monorepo.
 *
 * Serves the pre-built studio SPA and implements the project API that the
 * studio expects. Ports the API logic from packages/studio/vite.config.ts.
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join, sep, basename, dirname, extname } from "node:path";
import { createProjectWatcher, type ProjectWatcher } from "./fileWatcher.js";

// ── Path resolution ─────────────────────────────────────────────────────────

function resolveDistDir(): string {
  // __dirname is injected by tsup banner — points to dist/ in the built CLI.
  // In dev mode (tsx), it points to src/server/.
  const builtPath = resolve(__dirname, "studio");
  if (existsSync(resolve(builtPath, "index.html"))) return builtPath;
  // Fallback for dev mode: built studio is at packages/studio/dist
  const devPath = resolve(__dirname, "..", "..", "..", "studio", "dist");
  if (existsSync(resolve(devPath, "index.html"))) return devPath;
  return builtPath; // let it fail with a clear 404
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

// ── Safety ──────────────────────────────────────────────────────────────────

function isSafePath(base: string, resolved: string): boolean {
  const norm = resolve(base) + sep;
  return resolved.startsWith(norm) || resolved === resolve(base);
}

// ── MIME types ──────────────────────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

// ── File helpers ────────────────────────────────────────────────────────────

function walkDir(dir: string, prefix: string = ""): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...walkDir(join(dir, entry.name), rel));
    } else {
      files.push(rel);
    }
  }
  return files;
}

function serveStaticFile(filePath: string): Response | null {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return null;
  const mime = getMimeType(filePath);
  const content = readFileSync(filePath);
  return new Response(content, {
    headers: { "Content-Type": mime, "Cache-Control": "no-store" },
  });
}

// ── Sub-composition builder ─────────────────────────────────────────────────
// Ports vite.config.ts lines 216-301

function buildSubCompositionHtml(
  projectDir: string,
  compPath: string,
  runtimeUrl: string,
): string | null {
  const compFile = resolve(projectDir, compPath);
  if (!isSafePath(projectDir, compFile) || !existsSync(compFile) || !statSync(compFile).isFile()) {
    return null;
  }

  let rawComp = readFileSync(compFile, "utf-8");

  // Extract content from <template> if present
  const templateMatch = rawComp.match(/<template>([\s\S]*)<\/template>/i);
  let content = (templateMatch ? templateMatch[1] : rawComp) ?? rawComp;

  // Inline nested data-composition-src references
  content = content.replace(
    /(<[^>]*?)(data-composition-src=["']([^"']+)["'])([^>]*>)/g,
    (_match, before, srcAttr, src, after) => {
      const nestedFile = join(projectDir, src);
      if (!existsSync(nestedFile)) return before + srcAttr + after;
      const nestedRaw = readFileSync(nestedFile, "utf-8");
      const nestedTemplate = nestedRaw.match(/<template>([\s\S]*)<\/template>/i);
      const nestedContent = (nestedTemplate ? nestedTemplate[1] : nestedRaw) ?? nestedRaw;
      const styles: string[] = [];
      const scripts: string[] = [];
      let body = nestedContent
        .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => {
          styles.push(css);
          return "";
        })
        .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, (_, js) => {
          scripts.push(js);
          return "";
        });
      const innerRootMatch = body.match(
        /<([a-z][a-z0-9]*)\b[^>]*data-composition-id[^>]*>([\s\S]*)<\/\1>/i,
      );
      const innerHTML = innerRootMatch ? innerRootMatch[2] : body;
      return (
        before +
        srcAttr +
        after.replace(/>$/, ">") +
        innerHTML +
        (styles.length ? `<style>${styles.join("\n")}</style>` : "") +
        (scripts.length
          ? `<script>${scripts.map((s) => `(function(){try{${s}}catch(e){}})();`).join("\n")}</script>`
          : "")
      );
    },
  );

  return `<!DOCTYPE html>
<html>
<head>
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
<script data-hyperframes-preview-runtime="1" src="${runtimeUrl}"></script>
</head>
<body>
${content}
</body>
</html>`;
}

// ── Server factory ──────────────────────────────────────────────────────────

export interface StudioServerOptions {
  projectDir: string;
}

export interface StudioServer {
  app: Hono;
  watcher: ProjectWatcher;
}

export function createStudioServer(options: StudioServerOptions): StudioServer {
  const { projectDir } = options;
  const projectId = basename(projectDir);
  const studioDir = resolveDistDir();
  const runtimePath = resolveRuntimePath();
  const watcher = createProjectWatcher(projectDir);

  const app = new Hono();

  // ── API: runtime.js ───────────────────────────────────────────────────
  app.get("/api/runtime.js", (c) => {
    if (!existsSync(runtimePath)) return c.text("runtime not built", 404);
    return c.body(readFileSync(runtimePath, "utf-8"), 200, {
      "Content-Type": "text/javascript",
      "Cache-Control": "no-store",
    });
  });

  // ── API: SSE events ───────────────────────────────────────────────────
  app.get("/api/events", (c) => {
    return streamSSE(c, async (stream) => {
      const listener = () => {
        stream.writeSSE({ event: "file-change", data: "{}" }).catch(() => {});
      };
      watcher.addListener(listener);
      // Keep connection alive until client disconnects
      while (true) {
        await stream.sleep(30000);
      }
    });
  });

  // ── API: project listing ──────────────────────────────────────────────
  app.get("/api/projects", (c) => {
    return c.json({ projects: [{ id: projectId, title: projectId }] });
  });

  // ── API: project file tree ────────────────────────────────────────────
  app.get("/api/projects/:id", (c) => {
    const id = c.req.param("id");
    if (id !== projectId) return c.json({ error: "not found" }, 404);
    const files = walkDir(projectDir);
    return c.json({ id: projectId, files });
  });

  // ── API: preview — bundled composition ────────────────────────────────
  app.get("/api/projects/:id/preview", async (c) => {
    const id = c.req.param("id");
    if (id !== projectId) return c.json({ error: "not found" }, 404);

    let bundled: string;
    try {
      const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");
      bundled = await bundleToSingleHtml(projectDir);
    } catch {
      // Fallback to raw HTML
      const file = join(projectDir, "index.html");
      if (!existsSync(file)) return c.text("not found", 404);
      bundled = readFileSync(file, "utf-8");
    }

    // Inject <base> so relative asset paths resolve through /preview/ route
    const baseTag = `<base href="/api/projects/${projectId}/preview/">`;
    if (bundled.includes("<head>")) {
      bundled = bundled.replace("<head>", `<head>${baseTag}`);
    } else {
      bundled = baseTag + bundled;
    }

    // Fix empty runtime src if present
    bundled = bundled.replace(
      'data-hyperframes-preview-runtime="1" src=""',
      'data-hyperframes-preview-runtime="1" src="/api/runtime.js"',
    );

    return c.html(bundled);
  });

  // ── API: sub-composition preview ──────────────────────────────────────
  app.get("/api/projects/:id/preview/comp/*", (c) => {
    const id = c.req.param("id");
    if (id !== projectId) return c.json({ error: "not found" }, 404);
    const compPath = c.req.path.replace(`/api/projects/${id}/preview/comp/`, "");
    const html = buildSubCompositionHtml(
      projectDir,
      decodeURIComponent(compPath),
      "/api/runtime.js",
    );
    if (!html) return c.text("not found", 404);
    return c.html(html);
  });

  // ── API: preview static assets ────────────────────────────────────────
  app.get("/api/projects/:id/preview/*", (c) => {
    const id = c.req.param("id");
    if (id !== projectId) return c.json({ error: "not found" }, 404);
    const subPath = decodeURIComponent(
      c.req.path.replace(`/api/projects/${id}/preview/`, "").split("?")[0] ?? "",
    );
    const file = resolve(projectDir, subPath);
    if (!isSafePath(projectDir, file) || !existsSync(file) || !statSync(file).isFile()) {
      return c.text("not found", 404);
    }
    const mime = getMimeType(file);
    const content = readFileSync(file);
    return new Response(content, {
      headers: { "Content-Type": mime, "Cache-Control": "no-store" },
    });
  });

  // ── API: file read ────────────────────────────────────────────────────
  app.get("/api/projects/:id/files/*", (c) => {
    const id = c.req.param("id");
    if (id !== projectId) return c.json({ error: "not found" }, 404);
    const filePath = decodeURIComponent(c.req.path.replace(`/api/projects/${id}/files/`, ""));
    const file = resolve(projectDir, filePath);
    if (!isSafePath(projectDir, file) || !existsSync(file)) {
      return c.text("not found", 404);
    }
    const content = readFileSync(file, "utf-8");
    return c.json({ filename: filePath, content });
  });

  // ── API: file write ───────────────────────────────────────────────────
  app.put("/api/projects/:id/files/*", async (c) => {
    const id = c.req.param("id");
    if (id !== projectId) return c.json({ error: "not found" }, 404);
    const filePath = decodeURIComponent(c.req.path.replace(`/api/projects/${id}/files/`, ""));
    const file = resolve(projectDir, filePath);
    if (!isSafePath(projectDir, file)) {
      return c.json({ error: "forbidden" }, 403);
    }
    // Ensure parent directory exists
    const dir = dirname(file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const body = await c.req.text();
    writeFileSync(file, body, "utf-8");
    return c.json({ ok: true });
  });

  // ── API: stub endpoints ───────────────────────────────────────────────
  app.get("/api/resolve-session/:id", (c) => c.json({ error: "not available" }, 404));

  // ── API: render ─────────────────────────────────────────────────────
  // In-memory job store for active renders
  const renderJobs = new Map<
    string,
    { status: string; progress: number; error?: string; outputPath?: string }
  >();

  app.post("/api/projects/:id/render", async (c) => {
    const id = c.req.param("id");
    if (id !== projectId) return c.json({ error: "not found" }, 404);

    const jobId = Math.random().toString(36).slice(2, 10);
    const outputDir = join(projectDir, "renders");
    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
    const outputPath = join(outputDir, `${projectId}.mp4`);

    renderJobs.set(jobId, { status: "rendering", progress: 0, outputPath });

    // Run render asynchronously
    (async () => {
      try {
        const { createRenderJob, executeRenderJob } = await import("@hyperframes/producer");
        const { ensureBrowser } = await import("../browser/manager.js");

        // Ensure browser is available and pass path to producer
        try {
          const browser = await ensureBrowser();
          if (browser.executablePath && !process.env.PRODUCER_HEADLESS_SHELL_PATH) {
            process.env.PRODUCER_HEADLESS_SHELL_PATH = browser.executablePath;
          }
        } catch {
          // Continue without — acquireBrowser will try its own resolution
        }

        const { trackRenderComplete } = await import("../telemetry/events.js");
        const { bytesToMb } = await import("../telemetry/system.js");
        const { freemem } = await import("node:os");

        const job = createRenderJob({ fps: 30, quality: "standard" });
        const startTime = Date.now();
        const onProgress = (j: { progress: number }) => {
          const entry = renderJobs.get(jobId);
          if (entry) entry.progress = j.progress;
        };
        await executeRenderJob(job, projectDir, outputPath, onProgress);
        const entry = renderJobs.get(jobId);
        if (entry) {
          entry.status = "complete";
          entry.progress = 100;
        }

        const elapsed = Date.now() - startTime;
        const perf = job.perfSummary;
        const compositionDurationMs = perf
          ? Math.round(perf.compositionDurationSeconds * 1000)
          : undefined;
        trackRenderComplete({
          durationMs: elapsed,
          fps: 30,
          quality: "standard",
          workers: perf?.workers ?? 1,
          docker: false,
          gpu: false,
          compositionDurationMs,
          compositionWidth: perf?.resolution.width,
          compositionHeight: perf?.resolution.height,
          totalFrames: perf?.totalFrames,
          speedRatio:
            compositionDurationMs && compositionDurationMs > 0 && elapsed > 0
              ? Math.round((compositionDurationMs / elapsed) * 100) / 100
              : undefined,
          captureAvgMs: perf?.captureAvgMs,
          capturePeakMs: perf?.capturePeakMs,
          peakMemoryMb: bytesToMb(process.memoryUsage.rss()),
          memoryFreeMb: bytesToMb(freemem()),
        });
      } catch (err) {
        try {
          const { trackRenderError } = await import("../telemetry/events.js");
          const { bytesToMb } = await import("../telemetry/system.js");
          const { freemem } = await import("node:os");
          trackRenderError({
            fps: 30,
            quality: "standard",
            docker: false,
            errorMessage: err instanceof Error ? err.message : String(err),
            peakMemoryMb: bytesToMb(process.memoryUsage.rss()),
            memoryFreeMb: bytesToMb(freemem()),
          });
        } catch {
          // Telemetry must never break the studio
        }
        const entry = renderJobs.get(jobId);
        if (entry) {
          entry.status = "failed";
          entry.error = err instanceof Error ? err.message : String(err);
        }
      }
    })();

    return c.json({ jobId });
  });

  app.get("/api/render/:jobId/progress", (c) => {
    const { jobId } = c.req.param();
    const job = renderJobs.get(jobId);
    if (!job) return c.json({ error: "not found" }, 404);

    return streamSSE(c, async (stream) => {
      while (true) {
        const current = renderJobs.get(jobId);
        if (!current) break;
        await stream.writeSSE({
          event: "progress",
          data: JSON.stringify({
            progress: current.progress,
            status: current.status,
            error: current.error,
          }),
        });
        if (current.status === "complete" || current.status === "failed") break;
        await stream.sleep(500);
      }
    });
  });

  app.get("/api/render/:jobId/download", (c) => {
    const { jobId } = c.req.param();
    const job = renderJobs.get(jobId);
    if (!job?.outputPath || !existsSync(job.outputPath)) {
      return c.json({ error: "not found" }, 404);
    }
    const content = readFileSync(job.outputPath);
    return new Response(content, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="${projectId}.mp4"`,
      },
    });
  });

  // ── Studio SPA static files ───────────────────────────────────────────
  app.get("/assets/*", (c) => {
    const filePath = resolve(studioDir, c.req.path.slice(1)); // strip leading /
    const resp = serveStaticFile(filePath);
    return resp ?? c.text("not found", 404);
  });

  app.get("/icons/*", (c) => {
    const filePath = resolve(studioDir, c.req.path.slice(1));
    const resp = serveStaticFile(filePath);
    return resp ?? c.text("not found", 404);
  });

  // ── SPA fallback — serve index.html for all unmatched routes ──────────
  app.get("*", (c) => {
    const indexPath = resolve(studioDir, "index.html");
    if (!existsSync(indexPath)) {
      return c.text("Studio not found. Rebuild with: pnpm run build", 500);
    }
    return c.html(readFileSync(indexPath, "utf-8"));
  });

  return { app, watcher };
}
