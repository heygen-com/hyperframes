import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import type { MediaProcessingJobState, StudioApiAdapter } from "../types.js";
import { resolveWithinProject } from "../helpers/safePath.js";
import { probeMediaMetadata } from "../helpers/mediaMetadata.js";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const VIDEO_OUTPUT_EXTENSIONS = new Set([".webm", ".mov"]);
const QUALITIES = new Set(["fast", "balanced", "best"]);
const DEVICES = new Set(["auto", "cpu", "coreml", "cuda"]);

type BackgroundRemovalQuality = "fast" | "balanced" | "best";
type BackgroundRemovalDevice = "auto" | "cpu" | "coreml" | "cuda";

interface BackgroundRemovalBody {
  inputPath?: string;
  outputPath?: string;
  createBackgroundPlate?: boolean;
  quality?: string;
  device?: string;
}

type JobWithCreatedAt = MediaProcessingJobState & { createdAt: number };
type ProbeMediaMetadata = typeof probeMediaMetadata;

function isVideoPath(path: string): boolean {
  return VIDEO_EXTENSIONS.has(extname(path).toLowerCase());
}

function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(path).toLowerCase());
}

function normalizeProjectAssetPath(path: string): string {
  return path
    .trim()
    .replace(/^[.]\//, "")
    .replace(/[?#].*$/, "");
}

function containsNullByte(path: string): boolean {
  return path.includes("\0");
}

function slugFileBase(path: string): string {
  const name = basename(path, extname(path))
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return name || "media";
}

function uniqueAssetPath(projectDir: string, assetPath: string): string {
  const ext = extname(assetPath);
  const withoutExt = assetPath.slice(0, -ext.length);
  let candidate = assetPath;
  for (let index = 2; existsSync(join(projectDir, candidate)); index++) {
    candidate = `${withoutExt}-${index}${ext}`;
  }
  return candidate;
}

function defaultOutputPath(projectDir: string, inputPath: string): string {
  const ext = isImagePath(inputPath) ? ".png" : ".webm";
  return uniqueAssetPath(projectDir, `assets/cutouts/${slugFileBase(inputPath)}-cutout${ext}`);
}

function defaultPlatePath(projectDir: string, inputPath: string): string {
  return uniqueAssetPath(projectDir, `assets/cutouts/${slugFileBase(inputPath)}-plate.webm`);
}

function makeJobId(projectId: string, mediaJobs: Map<string, JobWithCreatedAt>): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  const safeProject = projectId.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  const base = `${safeProject || "project"}_remove-bg_${stamp}`;
  if (!mediaJobs.has(base)) return base;
  for (let index = 2; ; index++) {
    const candidate = `${base}-${index}`;
    if (!mediaJobs.has(candidate)) return candidate;
  }
}

function normalizeQuality(value: string | undefined): BackgroundRemovalQuality {
  return QUALITIES.has(value ?? "") ? (value as BackgroundRemovalQuality) : "balanced";
}

function normalizeDevice(value: string | undefined): BackgroundRemovalDevice {
  return DEVICES.has(value ?? "") ? (value as BackgroundRemovalDevice) : "auto";
}

export function registerMediaRoutes(
  api: Hono,
  adapter: StudioApiAdapter,
  options: { probeMediaMetadata?: ProbeMediaMetadata } = {},
): void {
  const mediaJobs = new Map<string, JobWithCreatedAt>();
  const TTL_MS = 300_000;
  const readMediaMetadata = options.probeMediaMetadata ?? probeMediaMetadata;

  function cleanupFinishedJobs(): void {
    const now = Date.now();
    for (const [id, job] of mediaJobs) {
      if ((job.status === "complete" || job.status === "failed") && now - job.createdAt > TTL_MS) {
        mediaJobs.delete(id);
      }
    }
  }

  api.get("/projects/:id/media/metadata", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    const assetPath = normalizeProjectAssetPath(c.req.query("path") ?? "");
    if (!assetPath) return c.json({ error: "path required" }, 400);
    if (containsNullByte(assetPath)) return c.json({ error: "forbidden" }, 403);
    if (/^(?:https?:|data:|blob:)/i.test(assetPath)) {
      return c.json({ error: "media metadata requires a project-local asset" }, 400);
    }

    const filePath = resolveWithinProject(project.dir, assetPath);
    if (!filePath) return c.json({ error: "forbidden" }, 403);
    if (!existsSync(filePath)) return c.json({ error: "media not found" }, 404);

    return c.json({ path: assetPath, metadata: readMediaMetadata(filePath) });
  });

  api.post(
    "/projects/:id/media/remove-background",
    // fallow-ignore-next-line complexity
    async (c) => {
      cleanupFinishedJobs();
      if (!adapter.startBackgroundRemoval) {
        return c.json({ error: "background removal is not available in this Studio server" }, 501);
      }

      // fallow-ignore-next-line code-duplication
      const project = await adapter.resolveProject(c.req.param("id"));
      if (!project) return c.json({ error: "not found" }, 404);

      const body = (await c.req.json().catch(() => ({}))) as BackgroundRemovalBody;
      const inputAssetPath = body.inputPath ? normalizeProjectAssetPath(body.inputPath) : "";
      if (!inputAssetPath) return c.json({ error: "inputPath required" }, 400);
      if (containsNullByte(inputAssetPath)) return c.json({ error: "forbidden" }, 403);
      if (/^(?:https?:|data:|blob:)/i.test(inputAssetPath)) {
        return c.json({ error: "background removal requires a project-local media asset" }, 400);
      }

      const inputPath = resolveWithinProject(project.dir, inputAssetPath);
      if (!inputPath) return c.json({ error: "forbidden" }, 403);
      if (!existsSync(inputPath)) return c.json({ error: "input media not found" }, 404);

      const inputIsVideo = isVideoPath(inputAssetPath);
      const inputIsImage = isImagePath(inputAssetPath);
      if (!inputIsVideo && !inputIsImage) {
        return c.json({ error: "background removal supports video or image assets only" }, 400);
      }

      const requestedOutput = body.outputPath ? normalizeProjectAssetPath(body.outputPath) : "";
      if (requestedOutput && containsNullByte(requestedOutput)) {
        return c.json({ error: "forbidden" }, 403);
      }
      if (requestedOutput && !resolveWithinProject(project.dir, requestedOutput)) {
        return c.json({ error: "forbidden" }, 403);
      }
      const outputAssetPath = requestedOutput
        ? uniqueAssetPath(project.dir, requestedOutput)
        : defaultOutputPath(project.dir, inputAssetPath);
      const outputPath = resolveWithinProject(project.dir, outputAssetPath);
      if (!outputPath) return c.json({ error: "forbidden" }, 403);
      if (inputIsVideo && !VIDEO_OUTPUT_EXTENSIONS.has(extname(outputAssetPath).toLowerCase())) {
        return c.json({ error: "video background removal output must be .webm or .mov" }, 400);
      }
      if (inputIsImage && extname(outputAssetPath).toLowerCase() !== ".png") {
        return c.json({ error: "image background removal output must be .png" }, 400);
      }

      let backgroundOutputAssetPath: string | undefined;
      let backgroundOutputPath: string | undefined;
      if (body.createBackgroundPlate) {
        if (!inputIsVideo) {
          return c.json({ error: "background plates are only supported for video inputs" }, 400);
        }
        backgroundOutputAssetPath = defaultPlatePath(project.dir, inputAssetPath);
        backgroundOutputPath =
          resolveWithinProject(project.dir, backgroundOutputAssetPath) ?? undefined;
        if (!backgroundOutputPath) {
          return c.json({ error: "forbidden" }, 403);
        }
      }

      mkdirSync(dirname(outputPath), { recursive: true });
      if (backgroundOutputPath) mkdirSync(dirname(backgroundOutputPath), { recursive: true });

      const jobId = makeJobId(project.id, mediaJobs);
      const state = adapter.startBackgroundRemoval({
        project,
        inputPath,
        inputAssetPath,
        outputPath,
        outputAssetPath,
        backgroundOutputPath,
        backgroundOutputAssetPath,
        quality: normalizeQuality(body.quality),
        device: normalizeDevice(body.device),
        jobId,
      }) as JobWithCreatedAt;
      state.createdAt = Date.now();
      mediaJobs.set(jobId, state);

      return c.json({
        jobId,
        status: state.status,
        outputPath: outputAssetPath,
        backgroundOutputPath: backgroundOutputAssetPath,
      });
    },
  );

  api.get("/media-jobs/:jobId/progress", (c) => {
    cleanupFinishedJobs();
    const { jobId } = c.req.param();
    const job = mediaJobs.get(jobId);
    if (!job) return c.json({ error: "not found" }, 404);

    return streamSSE(c, async (stream) => {
      while (true) {
        const current = mediaJobs.get(jobId);
        if (!current) break;
        await stream.writeSSE({
          event: "progress",
          data: JSON.stringify({
            id: current.id,
            status: current.status,
            progress: current.progress,
            stage: current.stage,
            outputPath: current.outputAssetPath,
            backgroundOutputPath: current.backgroundOutputAssetPath,
            error: current.error,
            provider: current.provider,
            framesProcessed: current.framesProcessed,
            durationSeconds: current.durationSeconds,
            avgMsPerFrame: current.avgMsPerFrame,
          }),
        });
        if (current.status === "complete" || current.status === "failed") break;
        await stream.sleep(500);
      }
    });
  });
}
