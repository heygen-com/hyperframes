import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { existsSync, readFileSync, mkdirSync, unlinkSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { StudioApiAdapter, RenderJobState } from "../types.js";
import { VALID_CANVAS_RESOLUTIONS, type CanvasResolution } from "@hyperframes/parsers";
import { formatRenderOutputTimestamp, parseFps } from "@hyperframes/core";
import { resolveWithinProject } from "../helpers/safePath.js";
import { isVariablesPayload, VARIABLES_PAYLOAD_ERROR } from "../helpers/variablesPayload.js";

const VALID_RESOLUTIONS = new Set<string>(VALID_CANVAS_RESOLUTIONS);

export function registerRenderRoutes(api: Hono, adapter: StudioApiAdapter): void {
  // Scoped job store — not shared across createStudioApi() calls
  const renderJobs = new Map<string, RenderJobState & { createdAt: number }>();

  // TTL cleanup for completed jobs (5 minutes)
  const TTL_MS = 300_000;
  const CLEANUP_INTERVAL_MS = 60_000;
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;

  const cleanupEnabled = () =>
    typeof process !== "undefined" &&
    process.env.NODE_ENV !== "production" &&
    !process.argv.includes("build");

  const cleanupFinishedJobs = () => {
    const now = Date.now();
    for (const [key, job] of renderJobs) {
      if (job.status !== "rendering" && now - job.createdAt > TTL_MS) {
        renderJobs.delete(key);
      }
    }
    if (renderJobs.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  };

  const ensureCleanupTimer = () => {
    if (cleanupTimer || !cleanupEnabled()) return;
    cleanupTimer = setInterval(cleanupFinishedJobs, CLEANUP_INTERVAL_MS);
    if (typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
      cleanupTimer.unref();
    }
  };

  ensureCleanupTimer();

  // Start a render
  api.post("/projects/:id/render", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    const body = (await c.req.json().catch(() => ({}))) as {
      // Polymorphic per design note in core.types.Fps:
      //   number → integer fps (e.g. 30)
      //   string → rational fps (e.g. "30000/1001" for NTSC 29.97)
      // Decimals are rejected on purpose so the exact denominator stays
      // unambiguous (29.97 ≠ 30000/1001 when ffmpeg consumes them).
      fps?: number | string;
      quality?: string;
      format?: string;
      resolution?: string;
      composition?: string;
      // Browser telemetry id, so the server-emitted render outcome is
      // attributed to the user who triggered the render (joinable funnel).
      telemetryDistinctId?: string;
      // Composition-variable overrides ({variableId: value}), injected as
      // window.__hfVariables — same channel as `hyperframes render --variables`.
      variables?: Record<string, unknown>;
    };
    const VALID_FORMATS = new Set(["mp4", "webm", "mov"]);
    const FORMAT_EXT: Record<string, string> = { mp4: ".mp4", webm: ".webm", mov: ".mov" };
    const format = VALID_FORMATS.has(body.format ?? "") ? (body.format as string) : "mp4";

    // Default to 30 fps when unset or unparseable. The route stays lenient on
    // invalid fps values (matching the lenient handling of `resolution` and
    // `quality` already in this file) — the producer surfaces a clearer error
    // message if the caller really did mean to fail loudly.
    const fpsParse = body.fps === undefined ? null : parseFps(body.fps);
    const fps = fpsParse && fpsParse.ok ? fpsParse.value : { num: 30, den: 1 };
    const quality = ["draft", "standard", "high"].includes(body.quality ?? "")
      ? (body.quality as string)
      : "standard";
    const outputResolution = VALID_RESOLUTIONS.has(body.resolution ?? "")
      ? (body.resolution as CanvasResolution)
      : undefined;
    let composition: string | undefined;
    if (typeof body.composition === "string" && body.composition.length > 0) {
      // `body.composition` is attacker-controlled (from c.req.json()).
      // resolveWithinProject dereferences symlinks, so an in-project symlink
      // pointing outside the root can't smuggle the render target out.
      if (!resolveWithinProject(project.dir, body.composition)) {
        return c.json({ error: "composition path must be within the project directory" }, 400);
      }
      composition = body.composition;
    }

    // Unlike fps/quality (lenient with safe fallbacks), a malformed variables
    // payload means the user's values would be silently dropped — fail loudly.
    let variables: Record<string, unknown> | undefined;
    if (body.variables !== undefined) {
      if (!isVariablesPayload(body.variables)) {
        return c.json({ error: VARIABLES_PAYLOAD_ERROR }, 400);
      }
      variables = body.variables;
    }

    const now = new Date();
    const jobId = `${project.id}_${formatRenderOutputTimestamp(now)}`;
    const rendersDir = adapter.rendersDir(project);
    if (!existsSync(rendersDir)) mkdirSync(rendersDir, { recursive: true });
    const ext = FORMAT_EXT[format] ?? ".mp4";
    const outputPath = join(rendersDir, `${jobId}${ext}`);

    const jobState = adapter.startRender({
      project,
      outputPath,
      format: format as "mp4" | "webm" | "mov",
      fps,
      quality,
      jobId,
      outputResolution,
      composition,
      variables,
      distinctId:
        typeof body.telemetryDistinctId === "string" ? body.telemetryDistinctId : undefined,
    });
    (jobState as RenderJobState & { createdAt: number }).createdAt = Date.now();
    renderJobs.set(jobId, jobState as RenderJobState & { createdAt: number });

    ensureCleanupTimer();

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
        if (current.status !== "rendering") break;
        await stream.sleep(500);
      }
    });
  });

  // Cancel an in-flight render. Marks the job cancelled immediately (so the
  // SSE stream terminates) and invokes the adapter's abort hook when present.
  api.post("/render/:jobId/cancel", (c) => {
    const { jobId } = c.req.param();
    const job = renderJobs.get(jobId);
    if (!job) return c.json({ error: "not found" }, 404);
    if (job.status === "rendering") {
      job.status = "cancelled";
      job.cancel?.();
    }
    return c.json({ status: job.status });
  });

  const RENDER_MIME: Record<string, string> = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
  };
  const RENDER_EXTENSIONS = Object.keys(RENDER_MIME);

  function renderContentType(filePath: string): string {
    const ext = RENDER_EXTENSIONS.find((e) => filePath.endsWith(e));
    return (ext && RENDER_MIME[ext]) ?? "video/mp4";
  }

  // Serve render inline (for in-browser playback — opens in a new tab)
  // fallow-ignore-next-line code-duplication
  api.get("/render/:jobId/view", (c) => {
    const { jobId } = c.req.param();
    const job = renderJobs.get(jobId);
    if (!job?.outputPath || !existsSync(job.outputPath)) {
      return c.json({ error: "not found" }, 404);
    }
    const contentType = renderContentType(job.outputPath);
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
  // fallow-ignore-next-line code-duplication
  api.get("/render/:jobId/download", (c) => {
    const { jobId } = c.req.param();
    const job = renderJobs.get(jobId);
    if (!job?.outputPath || !existsSync(job.outputPath)) {
      return c.json({ error: "not found" }, 404);
    }
    const contentType = renderContentType(job.outputPath);
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
        for (const ext of [".mp4", ".webm", ".mov", ".meta.json"]) {
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
    // Containment guard: the filename is attacker-controlled wildcard input, so
    // route it through the same chokepoint every other project-scoped path uses.
    // Literal `..` is collapsed upstream by the URL parser, but a bare join() +
    // readFileSync still followed an in-rendersDir symlink pointing outside the
    // dir; resolveWithinProject canonicalizes with realpath before serving.
    const fp = resolveWithinProject(rendersDir, filename);
    if (!fp) return c.json({ error: "forbidden" }, 403);
    if (!existsSync(fp)) return c.json({ error: "not found" }, 404);
    const contentType = renderContentType(fp);
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
      .filter((f) => f.endsWith(".mp4") || f.endsWith(".webm") || f.endsWith(".mov"))
      .map((f) => {
        const fp = join(rendersDir, f);
        const stat = statSync(fp);
        const rid = f.replace(/\.(mp4|webm|mov)$/, "");
        const metaPath = join(rendersDir, `${rid}.meta.json`);
        let status: "complete" | "failed" = "complete";
        let durationMs: number | undefined;
        if (existsSync(metaPath)) {
          try {
            const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
            // A stale failed sidecar can remain after a retry succeeds. An
            // existing output artifact is authoritative for the list view;
            // don't present a downloadable render as failed solely because
            // an earlier attempt left behind failed metadata.
            if (meta.status === "failed" && !existsSync(fp)) status = "failed";
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
