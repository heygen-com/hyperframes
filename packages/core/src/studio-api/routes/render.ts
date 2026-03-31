import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { existsSync, readFileSync, mkdirSync, unlinkSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { StudioApiAdapter, RenderJobState } from "../types.js";

export function registerRenderRoutes(api: Hono, adapter: StudioApiAdapter): void {
  // Scoped job store — not shared across createStudioApi() calls
  const renderJobs = new Map<string, RenderJobState & { createdAt: number }>();

  // TTL cleanup for completed jobs (5 minutes)
  const TTL_MS = 300_000;
  const CLEANUP_INTERVAL_MS = 60_000;
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;

  if (
    typeof process !== "undefined" &&
    process.env.NODE_ENV !== "production" &&
    !process.argv.includes("build")
  ) {
    cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, job] of renderJobs) {
        if (
          (job.status === "complete" || job.status === "failed") &&
          now - job.createdAt > TTL_MS
        ) {
          renderJobs.delete(key);
        }
      }
      // Self-cleanup when no jobs remain
      if (renderJobs.size === 0 && cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
      }
    }, CLEANUP_INTERVAL_MS);
    // Prevent the timer from keeping the process alive
    if (cleanupTimer && typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
      cleanupTimer.unref();
    }
  }

  // Start a render
  api.post("/projects/:id/render", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    const body = (await c.req.json().catch(() => ({}))) as {
      fps?: number;
      quality?: string;
      format?: string;
    };
    const format = body.format === "webm" ? "webm" : "mp4";
    const fps: 24 | 30 | 60 = body.fps === 24 || body.fps === 60 ? body.fps : 30;
    const quality = ["draft", "standard", "high"].includes(body.quality ?? "")
      ? (body.quality as string)
      : "standard";

    const now = new Date();
    const datePart = now.toISOString().slice(0, 10);
    const timePart = now.toTimeString().slice(0, 8).replace(/:/g, "-");
    const jobId = `${project.id}_${datePart}_${timePart}`;
    const rendersDir = adapter.rendersDir(project);
    if (!existsSync(rendersDir)) mkdirSync(rendersDir, { recursive: true });
    const ext = format === "webm" ? ".webm" : ".mp4";
    const outputPath = join(rendersDir, `${jobId}${ext}`);

    const jobState = adapter.startRender({
      project,
      outputPath,
      format: format as "mp4" | "webm",
      fps,
      quality,
      jobId,
    });
    (jobState as RenderJobState & { createdAt: number }).createdAt = Date.now();
    renderJobs.set(jobId, jobState as RenderJobState & { createdAt: number });

    // Restart cleanup timer if needed
    if (!cleanupTimer && typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
      cleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [key, job] of renderJobs) {
          if (
            (job.status === "complete" || job.status === "failed") &&
            now - job.createdAt > TTL_MS
          ) {
            renderJobs.delete(key);
          }
        }
        if (renderJobs.size === 0 && cleanupTimer) {
          clearInterval(cleanupTimer);
          cleanupTimer = null;
        }
      }, CLEANUP_INTERVAL_MS);
      if (cleanupTimer && typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
        cleanupTimer.unref();
      }
    }

    return c.json({ jobId, status: "rendering" });
  });

  // SSE progress stream
  api.get("/render/:jobId/progress", (c) => {
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
            stage: current.stage,
            error: current.error,
          }),
        });
        if (current.status === "complete" || current.status === "failed") break;
        await stream.sleep(500);
      }
    });
  });

  // Serve render inline (for in-browser playback — opens in a new tab)
  api.get("/render/:jobId/view", (c) => {
    const { jobId } = c.req.param();
    const job = renderJobs.get(jobId);
    if (!job?.outputPath || !existsSync(job.outputPath)) {
      return c.json({ error: "not found" }, 404);
    }
    const isWebm = job.outputPath.endsWith(".webm");
    const contentType = isWebm ? "video/webm" : "video/mp4";
    const filename = job.outputPath.split("/").pop() ?? `render.mp4`;
    const content = readFileSync(job.outputPath);
    return new Response(content, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${filename}"`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(content.length),
      },
    });
  });

  // Download render
  api.get("/render/:jobId/download", (c) => {
    const { jobId } = c.req.param();
    const job = renderJobs.get(jobId);
    if (!job?.outputPath || !existsSync(job.outputPath)) {
      return c.json({ error: "not found" }, 404);
    }
    const isWebm = job.outputPath.endsWith(".webm");
    const contentType = isWebm ? "video/webm" : "video/mp4";
    const filename = job.outputPath.split("/").pop() ?? `render.mp4`;
    const content = readFileSync(job.outputPath);
    return new Response(content, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  });

  // Delete render
  api.delete("/render/:jobId", (c) => {
    const { jobId } = c.req.param();
    for (const [, state] of renderJobs) {
      if (state.id === jobId && state.outputPath) {
        const dir = state.outputPath.replace(/\/[^/]+$/, "");
        for (const ext of [".mp4", ".webm", ".meta.json"]) {
          const fp = join(dir, `${jobId}${ext}`);
          if (existsSync(fp)) unlinkSync(fp);
        }
        break;
      }
    }
    renderJobs.delete(jobId);
    return c.json({ deleted: true });
  });

  // Serve render file directly from disk (no in-memory map dependency)
  api.get("/projects/:id/renders/file/*", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const filename = c.req.path.split("/renders/file/")[1];
    if (!filename) return c.json({ error: "missing filename" }, 400);
    const rendersDir = adapter.rendersDir(project);
    const fp = join(rendersDir, filename);
    if (!existsSync(fp)) return c.json({ error: "not found" }, 404);
    const isWebm = fp.endsWith(".webm");
    const contentType = isWebm ? "video/webm" : "video/mp4";
    const content = readFileSync(fp);
    return new Response(content, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${filename}"`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(content.length),
      },
    });
  });

  // List renders
  api.get("/projects/:id/renders", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const rendersDir = adapter.rendersDir(project);
    if (!existsSync(rendersDir)) return c.json({ renders: [] });
    const files = readdirSync(rendersDir)
      .filter((f) => f.endsWith(".mp4") || f.endsWith(".webm"))
      .map((f) => {
        const fp = join(rendersDir, f);
        const stat = statSync(fp);
        const rid = f.replace(/\.(mp4|webm)$/, "");
        const metaPath = join(rendersDir, `${rid}.meta.json`);
        let status: "complete" | "failed" = "complete";
        let durationMs: number | undefined;
        if (existsSync(metaPath)) {
          try {
            const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
            if (meta.status === "failed") status = "failed";
            if (meta.durationMs) durationMs = meta.durationMs;
          } catch {
            /* ignore */
          }
        }
        return {
          id: rid,
          filename: f,
          size: stat.size,
          createdAt: stat.mtimeMs,
          status,
          durationMs,
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
    // Register on-disk renders that aren't in the current session's job map
    // so they remain downloadable after a server restart.
    for (const file of files) {
      if (!renderJobs.has(file.id)) {
        renderJobs.set(file.id, {
          id: file.id,
          status: file.status,
          progress: 100,
          outputPath: join(rendersDir, file.filename),
          createdAt: file.createdAt,
        } as RenderJobState & { createdAt: number });
      }
    }
    return c.json({ renders: files });
  });
}
