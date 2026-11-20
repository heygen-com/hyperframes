import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { createReadStream, existsSync, lstatSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { Readable } from "node:stream";
import type { StudioApiAdapter, RenderJobState } from "../types.js";
import { VALID_CANVAS_RESOLUTIONS, type CanvasResolution } from "@hyperframes/parsers";
import { formatRenderOutputTimestamp, parseFps, fpsToNumber } from "@hyperframes/core";
import { replaceFileAtomically } from "@hyperframes/core/atomic-file";
import { RENDER_VARIABLES_FILE } from "@hyperframes/core/project-folders";
import {
  folderGone,
  isLinkFreeWithinProject,
  isPrivateProjectFile,
  mkdirWithinProject,
  realFilePath,
  resolveWithinProject,
} from "../helpers/safePath.js";
import { projectDirMissing } from "../helpers/projectDirMissing.js";
import { isVariablesPayload, VARIABLES_PAYLOAD_ERROR } from "../helpers/variablesPayload.js";
import { parseEncoderOptions, type EncoderOptionsBody } from "../helpers/encoderOptions.js";
import { forgetJobsFinishedLongerThan } from "../helpers/finishedJobs.js";
import { directoryZipResponse } from "../helpers/renderZipStream.js";
import { contentDispositionHeader } from "../helpers/contentDisposition.js";
import {
  RenderIdentityError,
  RenderIdentityStore,
  type RenderOwner,
} from "../helpers/renderIdentityStore.js";
import {
  buildRenderDeletionPlan,
  checkedRenderOutput,
  renderJobFamily,
} from "../helpers/renderDeletionPlan.js";
import type { RenderArtifactKind } from "../helpers/renderHistory.js";

const VALID_RESOLUTIONS = new Set<string>(VALID_CANVAS_RESOLUTIONS);
const RENDER_MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".gif": "image/gif",
  ".png": "image/png",
};
// `.png` serves frames inside a directory render; a loose PNG is never a render artifact.
type RenderFormat = "mp4" | "webm" | "mov" | "gif" | "png-sequence";

const FORMAT_EXT: Record<RenderFormat, string> = {
  mp4: ".mp4",
  webm: ".webm",
  mov: ".mov",
  gif: ".gif",
  "png-sequence": "",
};

const FORMAT_KIND: Record<RenderFormat, RenderArtifactKind> = {
  mp4: "file",
  webm: "file",
  mov: "file",
  gif: "file",
  "png-sequence": "directory",
};

function isRenderFormat(format: unknown): format is RenderFormat {
  return (
    format === "mp4" ||
    format === "webm" ||
    format === "mov" ||
    format === "gif" ||
    format === "png-sequence"
  );
}

function isRealDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
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

/** A single render file streamed from disk; inline responses also advertise byte ranges. */
function renderFileResponse(
  filePath: string,
  disposition: "inline" | "attachment",
  filename: string,
  method: string,
): Response {
  const headers = {
    "Content-Type": renderContentType(filePath),
    "Content-Disposition": contentDispositionHeader(disposition, filename),
    ...(disposition === "inline" ? { "Accept-Ranges": "bytes" } : {}),
    "Content-Length": String(statSync(filePath).size),
  };
  if (method === "HEAD") return new Response(null, { headers });
  // Node and DOM stream declarations differ; the response receives a web byte stream.
  const body = Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream;
  return new Response(body, { headers });
}

function renderRootAnchor(projectDir: string, root: string): string {
  const path = relative(projectDir, root);
  return path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)
    ? dirname(root)
    : projectDir;
}

export function registerRenderRoutes(api: Hono, adapter: StudioApiAdapter): void {
  // Scoped job store — not shared across createStudioApi() calls
  const renderJobs = new Map<string, RenderJobState>();
  const cancellingJobs = new Set<RenderJobState>();
  const CANCEL_SETTLE_MS = 45_000;
  const identities = new RenderIdentityStore(async () => {
    return (await adapter.listProjects()).map((project) => {
      const root = adapter.rendersDir(project);
      if (!isLinkFreeWithinProject(renderRootAnchor(project.dir, root), root))
        throw new RenderIdentityError("forbidden", 403);
      return root;
    });
  });

  // A finished job stays readable for 5 minutes after it finishes
  const TTL_MS = 300_000;
  const CLEANUP_INTERVAL_MS = 60_000;
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;

  const cleanupEnabled = () =>
    typeof process !== "undefined" &&
    process.env.NODE_ENV !== "production" &&
    !process.argv.includes("build");

  const cleanupFinishedJobs = () => {
    forgetJobsFinishedLongerThan(
      TTL_MS,
      renderJobs,
      (job) => job.status !== "rendering" && !cancellingJobs.has(job),
    );
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
    if (folderGone(project.dir)) return projectDirMissing(c);

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
    const requestedFps = fpsParse && fpsParse.ok ? fpsParse.value : { num: 30, den: 1 };
    const fps =
      format === "gif" && fpsToNumber(requestedFps) > 30 ? { num: 30, den: 1 } : requestedFps;
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

    const rendersDir = adapter.rendersDir(project);
    if (folderGone(project.dir)) return projectDirMissing(c);
    mkdirWithinProject(renderRootAnchor(project.dir, rendersDir), rendersDir);
    const ext = FORMAT_EXT[format];
    let owner: RenderOwner & { id: string };
    try {
      owner = await identities.claim(
        rendersDir,
        `${project.id}_${formatRenderOutputTimestamp(new Date())}`,
        ext,
        kind,
      );
    } catch (error) {
      if (folderGone(project.dir)) return projectDirMissing(c);
      throw error;
    }
    if (folderGone(project.dir)) return projectDirMissing(c);
    const jobId = owner.id;
    const outputName = owner.output;
    const outputPath = join(rendersDir, outputName);
    // A directory output is later removed recursively, so it must resolve inside renders/.
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
    renderJobs.set(jobId, jobState);

    ensureCleanupTimer();

    return c.json({ jobId, filename: outputName, status: "rendering" });
  });

  api.put("/projects/:id/render-variables", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const values: unknown = await c.req.json().catch(() => undefined);
    if (!isVariablesPayload(values)) return c.json({ error: VARIABLES_PAYLOAD_ERROR }, 400);
    if (folderGone(project.dir)) return projectDirMissing(c);
    // The variable ids are the composition's, so a write through a link could put chosen JSON in package.json. A link
    // on the way is refused; a link in the file's place is replaced by the rename, not written through.
    const path = join(project.dir, RENDER_VARIABLES_FILE);
    if (!isLinkFreeWithinProject(project.dir, dirname(path))) {
      return c.json({ error: "forbidden", why: "link" }, 403);
    }
    mkdirWithinProject(project.dir, dirname(path));
    replaceFileAtomically(path, JSON.stringify(values, null, 2) + "\n", 0o644);
    return c.json({ path: RENDER_VARIABLES_FILE });
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
  api.post("/render/:jobId/cancel", async (c) => {
    const { jobId } = c.req.param();
    const job = renderJobs.get(jobId);
    if (!job) return c.json({ error: "not found" }, 404);
    if (job.status === "rendering") {
      cancellingJobs.add(job);
      job.status = "cancelled";
      let giveUp: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise((done) => (giveUp = setTimeout(done, CANCEL_SETTLE_MS)));
      try {
        const settle = Promise.resolve()
          .then(() => job.cancel?.())
          .finally(() => {
            cancellingJobs.delete(job);
          });
        await Promise.race([settle, late]);
      } finally {
        clearTimeout(giveUp);
      }
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
  api.get("/render/:jobId/view", async (c) => {
    const jobId = c.req.param("jobId");
    const owner = await identities.resolve(jobId);
    const outputPath = owner && checkedRenderOutput(owner);
    if (!owner || owner.kind === "directory" || !outputPath || !isPlainFile(outputPath)) {
      return c.json({ error: "not found" }, 404);
    }
    return renderFileResponse(outputPath, "inline", owner.output, c.req.method);
  });

  // Download render
  api.get("/render/:jobId/download", async (c) => {
    const { jobId } = c.req.param();
    const state = renderJobs.get(jobId);
    const owner = await identities.resolve(jobId);
    const outputPath = owner && checkedRenderOutput(owner);
    if (owner?.kind === "directory" && outputPath) {
      const archive =
        state?.status === "rendering" ? null : directoryDownload(outputPath, owner.output);
      return archive ?? c.json({ error: "not found" }, 404);
    }
    if (!owner || !outputPath || !isPlainFile(outputPath)) {
      return c.json({ error: "not found" }, 404);
    }
    return renderFileResponse(outputPath, "attachment", owner.output, c.req.method);
  });

  // Delete render
  api.delete("/render/:jobId", async (c) => {
    const { jobId } = c.req.param();
    // `.` and `..` would name the renders folder itself; the router's normalizing is not trusted.
    if (
      jobId === "" ||
      jobId === "." ||
      jobId === ".." ||
      jobId.includes("/") ||
      jobId.includes("\\") ||
      jobId.includes("\0")
    ) {
      return c.json({ error: "forbidden" }, 403);
    }
    // The producer publishes from a hidden staging sibling at the end; a delete now removes nothing.
    if (renderJobs.get(jobId)?.status === "rendering") {
      return c.json({ error: "render in progress; cancel it first" }, 409);
    }
    const owner = await identities.resolve(jobId);
    if (!owner)
      return jobId.startsWith(".hf-render~")
        ? c.json({ error: "not found" }, 404)
        : c.json({ deleted: true });
    identities.assertWritable(owner);
    const plan = buildRenderDeletionPlan(owner, renderJobs.values(), cancellingJobs);
    plan.remove();
    for (const [id, job] of renderJobs) {
      if (renderJobFamily(job) === plan.family) renderJobs.delete(id);
    }
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
    return renderFileResponse(fp, "inline", basename(filename), c.req.method);
  });

  // List renders
  api.get("/projects/:id/renders", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const rendersDir = adapter.rendersDir(project);
    if (!existsSync(rendersDir)) return c.json({ renders: [] });
    if (!isLinkFreeWithinProject(renderRootAnchor(project.dir, rendersDir), rendersDir))
      return c.json({ error: "forbidden" }, 403);
    identities.includeRoot(rendersDir);
    const rows = (await identities.history()).filter(
      (row) => row.root === realFilePath(rendersDir),
    );
    rows.sort((a, b) => b.createdAt - a.createdAt);

    // Register on-disk renders that aren't in the current session's job map
    // so they remain downloadable after a server restart.
    for (const row of rows) {
      if (!renderJobs.has(row.id))
        renderJobs.set(row.id, {
          id: row.id,
          status: row.status,
          progress: 100,
          outputPath: row.path,
          kind: row.kind === "directory" ? "directory" : "file",
        });
    }
    return c.json({ renders: rows.map(({ path: _path, root: _root, ...render }) => render) });
  });
}
