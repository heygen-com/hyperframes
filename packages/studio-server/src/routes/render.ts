import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  existsSync,
  lstatSync,
  readFileSync,
  unlinkSync,
  readdirSync,
  statSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import type { StudioApiAdapter, RenderJobState } from "../types.js";
import { VALID_CANVAS_RESOLUTIONS, type CanvasResolution } from "@hyperframes/parsers";
import { formatRenderOutputTimestamp, parseFps } from "@hyperframes/core";
import {
  folderGone,
  isPrivateProjectFile,
  mkdirWithinProject,
  resolveWithinProject,
} from "../helpers/safePath.js";
import { projectDirMissing } from "../helpers/projectDirMissing.js";
import { isVariablesPayload, VARIABLES_PAYLOAD_ERROR } from "../helpers/variablesPayload.js";
import { parseEncoderOptions, type EncoderOptionsBody } from "../helpers/encoderOptions.js";
import { directoryZipResponse } from "../helpers/renderZipStream.js";
import { contentDispositionHeader } from "../helpers/contentDisposition.js";
import { readRenderDirectoryStats } from "../helpers/renderDirectoryStats.js";

const VALID_RESOLUTIONS = new Set<string>(VALID_CANVAS_RESOLUTIONS);
const RENDER_MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".png": "image/png",
};
// `.png` is only a MIME type for frames inside a directory render, never a
// standalone render artifact, so it stays out of the delete/list candidates.
const RENDER_FILE_EXTENSIONS = [".mp4", ".webm", ".mov"] as const;
const RENDER_ARTIFACT_EXTENSIONS = [...RENDER_FILE_EXTENSIONS, ".meta.json"] as const;
const RENDER_FILE_PATTERN = /\.(mp4|webm|mov)$/;

type RenderFormat = "mp4" | "webm" | "mov" | "png-sequence";
type RenderArtifactKind = "file" | "directory";

const FORMAT_EXT: Record<RenderFormat, string> = {
  mp4: ".mp4",
  webm: ".webm",
  mov: ".mov",
  "png-sequence": "",
};

const FORMAT_KIND: Record<RenderFormat, RenderArtifactKind> = {
  mp4: "file",
  webm: "file",
  mov: "file",
  "png-sequence": "directory",
};

function isRenderFormat(format: unknown): format is RenderFormat {
  return format === "mp4" || format === "webm" || format === "mov" || format === "png-sequence";
}

interface RenderArtifact {
  kind: RenderArtifactKind;
  /** Containment-checked path (symlinks resolved). */
  path: string;
  /** The literal `renders/<name>` entry, used where symlinks must not be followed. */
  candidatePath: string;
}

function resolveRenderArtifacts(
  directories: readonly string[],
  jobId: string,
): RenderArtifact[] | null {
  const artifacts: RenderArtifact[] = [];
  for (const directory of new Set(directories)) {
    if (!existsSync(directory)) continue;
    const names: Array<{ kind: RenderArtifactKind; name: string }> = [
      { kind: "directory", name: jobId },
      ...RENDER_ARTIFACT_EXTENSIONS.map((extension) => ({
        kind: "file" as const,
        name: `${jobId}${extension}`,
      })),
    ];
    for (const { kind, name } of names) {
      const path = resolveWithinProject(directory, name);
      if (!path) return null;
      artifacts.push({ kind, path, candidatePath: join(directory, name) });
    }
  }
  return artifacts;
}

function isRealDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function deleteRenderArtifact(artifact: RenderArtifact): void {
  if (artifact.kind === "file") {
    if (existsSync(artifact.path)) unlinkSync(artifact.path);
    return;
  }
  // lstat on the literal entry: a symlink is never followed into a recursive
  // removal, even one whose target is inside the project.
  if (isRealDirectory(artifact.candidatePath)) {
    rmSync(artifact.candidatePath, { recursive: true, force: true });
  }
}

function directoryDownload(directory: string, jobId: string): Response | null {
  if (!isRealDirectory(directory)) return null;
  try {
    return directoryZipResponse(directory, jobId);
  } catch {
    return null;
  }
}

function renderContentType(filePath: string): string {
  const ext = Object.keys(RENDER_MIME).find((e) => filePath.endsWith(e));
  return (ext && RENDER_MIME[ext]) ?? "video/mp4";
}

/** A single render file read from disk; inline responses also advertise byte ranges. */
function renderFileResponse(
  filePath: string,
  disposition: "inline" | "attachment",
  filename: string,
): Response {
  const content = readFileSync(filePath);
  return new Response(content, {
    headers: {
      "Content-Type": renderContentType(filePath),
      "Content-Disposition": contentDispositionHeader(disposition, filename),
      ...(disposition === "inline" ? { "Accept-Ranges": "bytes" } : {}),
      "Content-Length": String(content.length),
    },
  });
}

interface RenderMeta {
  status?: unknown;
  durationMs?: unknown;
  audioLoweredDb?: unknown;
  frameCount?: unknown;
  size?: unknown;
  audioSidecar?: unknown;
}

function readRenderMeta(metaPath: string): RenderMeta | null {
  if (!existsSync(metaPath)) return null;
  try {
    const meta: unknown = JSON.parse(readFileSync(metaPath, "utf-8"));
    return meta && typeof meta === "object" ? meta : null;
  } catch {
    return null;
  }
}

type RenderListingRow = {
  id: string;
  filename: string;
  path: string;
  size: number;
  createdAt: number;
  status: "complete" | "failed";
  durationMs?: number;
  audioLoweredDb?: number;
} & ({ kind?: undefined } | { kind: "directory"; frameCount: number; audioSidecar: boolean });

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

    const body = (await c.req.json().catch(() => ({}))) as EncoderOptionsBody & {
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
      // Explicit "this browser profile opted out" flag. Distinct from simply
      // omitting the id: an OLD client omits it too, and that case falls back
      // to the install anonymousId. Only an explicit `true` suppresses.
      telemetryOptOut?: boolean;
      // Composition-variable overrides ({variableId: value}), injected as
      // window.__hfVariables — same channel as `hyperframes render --variables`.
      variables?: Record<string, unknown>;
      gpu?: boolean;
      previewMotionBlur?: boolean;
      pageMotionBlur?: unknown;
    };
    const format: RenderFormat = isRenderFormat(body.format) ? body.format : "mp4";
    const kind = FORMAT_KIND[format];

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
        if (folderGone(project.dir)) return projectDirMissing(c);
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

    const encoder = parseEncoderOptions(body, format);
    if (!encoder.ok) return c.json({ error: encoder.error }, 400);

    const requestedPageMotionBlur = body.pageMotionBlur;
    if (requestedPageMotionBlur !== undefined && requestedPageMotionBlur !== "off") {
      return c.json({ error: "pageMotionBlur must be off when supplied" }, 400);
    }
    const pageMotionBlur =
      requestedPageMotionBlur === undefined && body.previewMotionBlur === false
        ? "off"
        : requestedPageMotionBlur;

    const now = new Date();
    const jobId = `${project.id}_${formatRenderOutputTimestamp(now)}`;
    const rendersDir = adapter.rendersDir(project);
    mkdirWithinProject(project.dir, rendersDir);
    const outputName = `${jobId}${FORMAT_EXT[format]}`;
    const outputPath = join(rendersDir, outputName);
    // A directory output is later removed recursively, so make sure it can
    // only ever land inside the renders folder.
    const checkedOutput = resolveWithinProject(rendersDir, outputName);
    if (!checkedOutput || isPrivateProjectFile(project.dir, checkedOutput)) {
      return c.json({ error: "forbidden" }, 403);
    }

    const jobState = adapter.startRender({
      project,
      outputPath,
      format,
      fps,
      quality,
      jobId,
      outputResolution,
      composition,
      variables,
      ...encoder.options,
      useGpu: body.gpu === true && format === "mp4",
      distinctId:
        typeof body.telemetryDistinctId === "string" ? body.telemetryDistinctId : undefined,
      telemetryOptOut: body.telemetryOptOut === true,
      ...(pageMotionBlur === undefined ? {} : { pageMotionBlur }),
    });
    jobState.kind ??= kind;
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
            ...(current.status === "complete" && current.audioLoweredDb !== undefined
              ? { audioLoweredDb: current.audioLoweredDb }
              : {}),
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

  const isPlainFile = (path: string): boolean => {
    try {
      return lstatSync(path).isFile();
    } catch {
      return false;
    }
  };

  // Serve render inline (for in-browser playback — opens in a new tab).
  // Directory renders are not playable, so they fall through to 404.
  api.get("/render/:jobId/view", (c) => {
    const job = renderJobs.get(c.req.param("jobId"));
    if (!job?.outputPath || job.kind === "directory" || !isPlainFile(job.outputPath)) {
      return c.json({ error: "not found" }, 404);
    }
    return renderFileResponse(job.outputPath, "inline", basename(job.outputPath));
  });

  // Download render. A directory render streams as a ZIP64 archive.
  api.get("/render/:jobId/download", (c) => {
    const { jobId } = c.req.param();
    const job = renderJobs.get(jobId);
    if (job?.kind === "directory") {
      const archive = job.status === "rendering" ? null : directoryDownload(job.outputPath, jobId);
      return archive ?? c.json({ error: "not found" }, 404);
    }
    if (!job?.outputPath || !isPlainFile(job.outputPath)) {
      return c.json({ error: "not found" }, 404);
    }
    return renderFileResponse(job.outputPath, "attachment", basename(job.outputPath));
  });

  async function renderDirectories(jobId: string): Promise<string[]> {
    const outputPath = renderJobs.get(jobId)?.outputPath;
    if (outputPath) return [dirname(outputPath)];

    const projects = await adapter.listProjects();
    return projects.map((project) => adapter.rendersDir(project));
  }

  // Delete render
  api.delete("/render/:jobId", async (c) => {
    const { jobId } = c.req.param();
    if (jobId.includes("/") || jobId.includes("\\") || jobId.includes("\0")) {
      return c.json({ error: "forbidden" }, 403);
    }
    // While rendering, the producer writes to a hidden staging sibling and
    // publishes the final artifact only at the end. Deleting now would remove
    // nothing and the render would reappear once it commits.
    if (renderJobs.get(jobId)?.status === "rendering") {
      return c.json({ error: "render in progress; cancel it first" }, 409);
    }
    const directories = await renderDirectories(jobId);
    const artifacts = resolveRenderArtifacts(directories, jobId);
    if (!artifacts) return c.json({ error: "forbidden" }, 403);

    for (const artifact of artifacts) deleteRenderArtifact(artifact);
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
    if (!fp || isPrivateProjectFile(project.dir, fp)) return c.json({ error: "forbidden" }, 403);
    if (!existsSync(fp) || !statSync(fp).isFile()) return c.json({ error: "not found" }, 404);
    return renderFileResponse(fp, "inline", basename(filename));
  });

  // List renders
  api.get("/projects/:id/renders", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const rendersDir = adapter.rendersDir(project);
    if (!existsSync(rendersDir)) return c.json({ renders: [] });

    const rows: RenderListingRow[] = [];
    for (const entry of readdirSync(rendersDir, { withFileTypes: true })) {
      // Dot-prefixed entries include the producer's in-progress staging dirs.
      if (entry.name.startsWith(".")) continue;
      // Dirent does not follow symlinks, so a symlinked directory is neither
      // listed as a directory render nor matched by the file extensions.
      const isDirectory = entry.isDirectory();
      if (!isDirectory && !RENDER_FILE_PATTERN.test(entry.name)) continue;
      const fp = resolveWithinProject(rendersDir, entry.name);
      if (!fp || isPrivateProjectFile(project.dir, fp)) continue;

      const rid = isDirectory ? entry.name : entry.name.replace(RENDER_FILE_PATTERN, "");
      const meta = readRenderMeta(join(rendersDir, `${rid}.meta.json`));
      let stat;
      try {
        stat = statSync(fp);
      } catch {
        continue;
      }
      // A stale failed sidecar can remain after a retry succeeds. An existing
      // output artifact is authoritative for the list view; don't present a
      // downloadable render as failed solely because an earlier attempt left
      // behind failed metadata.
      const status: "complete" | "failed" =
        meta?.status === "failed" && !existsSync(fp) ? "failed" : "complete";
      const durationMs =
        typeof meta?.durationMs === "number" && meta.durationMs ? meta.durationMs : undefined;
      const audioLoweredDb =
        typeof meta?.audioLoweredDb === "number" ? meta.audioLoweredDb : undefined;
      const base = {
        id: rid,
        filename: entry.name,
        path: fp,
        createdAt: stat.mtimeMs,
        status,
        durationMs,
        ...(audioLoweredDb !== undefined ? { audioLoweredDb } : {}),
      };

      if (!isDirectory) {
        rows.push({ ...base, size: stat.size });
        continue;
      }

      let frameCount: number;
      let size: number;
      let audioSidecar: boolean;
      if (typeof meta?.frameCount === "number" && typeof meta.size === "number") {
        frameCount = meta.frameCount;
        size = meta.size;
        audioSidecar = meta.audioSidecar === true;
      } else {
        // No cached facts (e.g. a CLI-rendered directory): scan once.
        try {
          ({ frameCount, size, audioSidecar } = readRenderDirectoryStats(fp));
        } catch {
          continue;
        }
        // An arbitrary folder without frames or a sidecar is not a render.
        if (frameCount === 0 && !meta) continue;
      }
      rows.push({ ...base, kind: "directory", size, frameCount, audioSidecar });
    }
    rows.sort((a, b) => b.createdAt - a.createdAt);

    // Register on-disk renders that aren't in the current session's job map
    // so they remain downloadable after a server restart.
    for (const row of rows) {
      if (!renderJobs.has(row.id)) {
        renderJobs.set(row.id, {
          id: row.id,
          status: row.status,
          progress: 100,
          outputPath: row.path,
          kind: row.kind === "directory" ? "directory" : "file",
          createdAt: row.createdAt,
        });
      }
    }
    return c.json({ renders: rows.map(({ path: _path, ...render }) => render) });
  });
}
