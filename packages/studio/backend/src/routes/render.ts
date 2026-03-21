/**
 * Render Routes
 *
 * Endpoints for rendering sandbox-studio compositions to MP4.
 * Runs the producer pipeline directly (no Docker needed for local dev).
 * Docker mode can be re-enabled later for production.
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { spawn, type ChildProcess } from "child_process";
import { existsSync, mkdirSync, statSync, createReadStream } from "fs";
import { join, resolve } from "path";
import { randomUUID } from "crypto";
import { Readable } from "stream";

const DATA_DIR = process.env.STUDIO_DATA_DIR
  ? resolve(process.env.STUDIO_DATA_DIR)
  : resolve(import.meta.dirname, "../../data/projects");
const RENDERS_DIR = process.env.STUDIO_RENDERS_DIR
  ? resolve(process.env.STUDIO_RENDERS_DIR)
  : resolve(import.meta.dirname, "../../data/renders");
const PRODUCER_CLI = resolve(import.meta.dirname, "../../../../producer/src/internal-render.ts");

interface RenderJobState {
  id: string;
  projectId: string;
  status: "queued" | "rendering" | "complete" | "failed";
  progress: number;
  stage: string;
  error?: string;
  outputPath?: string;
  startedAt: number;
  completedAt?: number;
  logs: string[];
  proc?: ChildProcess;
}

const jobs = new Map<string, RenderJobState>();

function getProjectDir(id: string) {
  return join(DATA_DIR, id);
}

function parseProgressFromLog(line: string): { progress?: number; stage?: string } {
  const progressMatch = line.match(/\[Producer\]\s+([\d.]+)%\s*-\s*(.*)/);
  if (progressMatch) {
    return {
      progress: parseFloat(progressMatch[1] ?? ""),
      stage: (progressMatch[2] ?? "").trim(),
    };
  }

  const stageMatch = line.match(/\[Orchestrator\]\s+Stage\s+(\d+\/\d+):\s+(.*)/);
  if (stageMatch) {
    return { stage: `${stageMatch[1] ?? ""}: ${stageMatch[2] ?? ""}` };
  }

  return {};
}

export const renderJobs = new Hono();
export const projectRender = new Hono();

// POST /api/projects/:id/render -- Start a render job
projectRender.post("/:id/render", async (c) => {
  const projectId = c.req.param("id");
  const projectDir = getProjectDir(projectId);

  if (!existsSync(projectDir)) {
    return c.json({ error: "Project not found" }, 404);
  }

  if (!existsSync(join(projectDir, "index.html"))) {
    return c.json({ error: "Project has no index.html" }, 400);
  }

  const body = await c.req.json<{ debug?: boolean; sequential?: boolean }>().catch(() => ({} as { debug?: boolean; sequential?: boolean }));
  const debug = body.debug ?? false;
  const sequential = body.sequential ?? false;

  if (!existsSync(RENDERS_DIR)) mkdirSync(RENDERS_DIR, { recursive: true });

  const jobId = randomUUID();
  const outputFilename = `${projectId}-${jobId.slice(0, 8)}.mp4`;
  const outputPath = join(RENDERS_DIR, outputFilename);

  const job: RenderJobState = {
    id: jobId,
    projectId,
    status: "rendering",
    progress: 0,
    stage: "Starting",
    outputPath,
    startedAt: Date.now(),
    logs: [],
  };

  jobs.set(jobId, job);

  // Run the producer directly via tsx (no Docker needed for local dev)
  const indexHtml = join(projectDir, "index.html");
  const args = [
    PRODUCER_CLI,
    indexHtml,
    "-o", outputPath,
    "-f", "30",
    "-q", "standard",
    ...(debug ? ["--debug"] : []),
    ...(sequential ? ["-w", "1"] : []),
  ];

  console.log(`[Render] Starting job ${jobId} for project ${projectId}`);
  console.log(`[Render] Command: tsx ${args.join(" ")}`);

  const proc = spawn("npx", ["tsx", ...args], {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: resolve(import.meta.dirname, "../../../.."),
  });
  job.proc = proc;

  const handleOutput = (data: Buffer) => {
    const lines = data.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      job.logs.push(line);
      if (job.logs.length > 1000) job.logs.shift();

      const { progress, stage } = parseProgressFromLog(line);
      if (progress !== undefined) job.progress = progress;
      if (stage) job.stage = stage;

      // Log to backend console for visibility
      console.log(`[Render:${jobId.slice(0, 8)}] ${line}`);
    }
  };

  proc.stdout?.on("data", handleOutput);
  proc.stderr?.on("data", handleOutput);

  proc.on("close", (code) => {
    job.completedAt = Date.now();
    delete job.proc;

    if (code === 0 && job.outputPath && existsSync(job.outputPath)) {
      job.status = "complete";
      job.progress = 100;
      job.stage = "Complete";
      console.log(`[Render] Job ${jobId} complete: ${job.outputPath}`);
    } else {
      job.status = "failed";
      job.error = `Process exited with code ${code}`;
      console.error(`[Render] Job ${jobId} failed (exit ${code})`);
    }
  });

  proc.on("error", (err) => {
    job.status = "failed";
    job.error = err.message;
    job.completedAt = Date.now();
    delete job.proc;
    console.error(`[Render] Job ${jobId} error: ${err.message}`);
  });

  return c.json({ jobId, status: "rendering" });
});

// GET /api/render/:id/status -- Job status
renderJobs.get("/:id/status", (c) => {
  const jobId = c.req.param("id");
  const job = jobs.get(jobId);

  if (!job) return c.json({ error: "Job not found" }, 404);

  return c.json({
    id: job.id,
    projectId: job.projectId,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    error: job.error,
    elapsed: job.completedAt
      ? job.completedAt - job.startedAt
      : Date.now() - job.startedAt,
  });
});

// GET /api/render/:id/progress -- SSE progress stream
renderJobs.get("/:id/progress", (c) => {
  const jobId = c.req.param("id");
  const job = jobs.get(jobId);

  if (!job) return c.json({ error: "Job not found" }, 404);

  return streamSSE(c, async (stream) => {
    let lastProgress = -1;
    let lastStage = "";

    const sendUpdate = async () => {
      const elapsed = job.completedAt
        ? job.completedAt - job.startedAt
        : Date.now() - job.startedAt;

      await stream.writeSSE({
        event: "progress",
        data: JSON.stringify({
          status: job.status,
          progress: job.progress,
          stage: job.stage,
          error: job.error,
          elapsed,
        }),
      });
    };

    await sendUpdate();

    while (job.status === "rendering" || job.status === "queued") {
      await new Promise((resolve) => setTimeout(resolve, 500));

      if (job.progress !== lastProgress || job.stage !== lastStage) {
        lastProgress = job.progress;
        lastStage = job.stage;
        await sendUpdate();
      }
    }

    await sendUpdate();
  });
});

// GET /api/render/:id/download -- Download the rendered MP4
renderJobs.get("/:id/download", (c) => {
  const jobId = c.req.param("id");
  const job = jobs.get(jobId);

  if (!job) return c.json({ error: "Job not found" }, 404);
  if (job.status !== "complete") return c.json({ error: "Render not complete" }, 400);
  if (!job.outputPath || !existsSync(job.outputPath)) {
    return c.json({ error: "Output file not found" }, 404);
  }

  const stats = statSync(job.outputPath);
  const filename = `${job.projectId}.mp4`;

  c.header("Content-Type", "video/mp4");
  c.header("Content-Length", String(stats.size));
  c.header("Content-Disposition", `attachment; filename="${filename}"`);

  const stream = createReadStream(job.outputPath);
  return c.body(Readable.toWeb(stream) as ReadableStream);
});

// GET /api/render/:id/logs -- Get render logs
renderJobs.get("/:id/logs", (c) => {
  const jobId = c.req.param("id");
  const job = jobs.get(jobId);

  if (!job) return c.json({ error: "Job not found" }, 404);

  return c.json({ logs: job.logs });
});
