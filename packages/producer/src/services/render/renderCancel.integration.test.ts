/**
 * A render interrupted mid-capture must leave no frames behind. Needs Chrome + ffmpeg (integration lane). Multi-worker
 * capture with parallel streaming off is the path that writes frames to disk.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "@hyperframes/engine";
import { createRenderJob, executeRenderJob } from "../renderOrchestrator.js";

const FIXTURE = join(import.meta.dirname, "renderCancel.fixture.ts");
const composition = (seconds: number) => `<!DOCTYPE html>
<html><head><style>body { margin: 0; background: #111; }</style></head>
<body>
  <div id="root" data-composition-id="cancel" data-start="0" data-duration="${seconds}" data-width="320"
    data-height="180" data-fps="30" data-no-timeline>
    <section class="clip" style="position:absolute;inset:0;background:#036" data-start="0"
      data-duration="${seconds}" data-track-index="1"></section>
  </div>
</body></html>
`;

const renderTempDirs = (dir: string): string[] =>
  readdirSync(dir).filter((name) => name.startsWith("work-") || name.includes(".hf-transaction-"));
const hasFrames = (dir: string): boolean =>
  readdirSync(dir, { recursive: true, encoding: "utf-8" }).some((path) =>
    /frame_\d+\.(jpg|png)$/.test(path),
  );

describe("render cancelled mid-capture", () => {
  let root: string;
  let outputDir: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "hf-render-cancel-"));
    outputDir = join(root, "renders");
    mkdirSync(join(root, "long"));
    writeFileSync(join(root, "long", "index.html"), composition(60));
    mkdirSync(join(root, "short"));
    writeFileSync(join(root, "short", "index.html"), composition(1));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const start = (name: string): ChildProcess =>
    spawn(
      process.execPath,
      ["--import", "tsx", FIXTURE, join(root, "long"), join(outputDir, name)],
      {
        env: { ...process.env, HF_CAPTURE_PARALLEL_STREAM: "false" },
        stdio: "ignore",
      },
    );
  const framesLand = () =>
    vi.waitFor(() => expect(existsSync(outputDir) && hasFrames(outputDir)).toBe(true), {
      timeout: 180_000,
      interval: 100,
    });

  /** Stops a render still running after a failed assertion, letting it close its own browsers first. */
  async function stop(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGINT");
    const exited = once(child, "exit");
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    await exited;
    clearTimeout(timer);
  }

  it("removes its work dir and staging dir on Ctrl+C", async () => {
    const child = start("cancelled.mp4");
    try {
      await framesLand();
      const workDir = renderTempDirs(outputDir).find((name) => name.startsWith("work-"))!;
      expect(JSON.parse(readFileSync(join(outputDir, workDir, "owner.json"), "utf-8")).pid).toBe(
        child.pid,
      );

      const exited = once(child, "exit");
      child.kill("SIGINT");
      await exited;
      expect(renderTempDirs(outputDir)).toEqual([]);
    } finally {
      await stop(child);
    }
  }, 240_000);

  it("the next render into the folder reclaims what a killed render left", async () => {
    const child = start("killed.mp4");
    try {
      await framesLand();
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        // Chrome runs in its own process group, so a killed render orphans it; reap it by pid.
        const browsers = spawnSync("pgrep", ["-P", String(child.pid)], {
          encoding: "utf-8",
        }).stdout;
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
        for (const pid of browsers.split("\n").filter(Boolean)) {
          try {
            process.kill(Number(pid), "SIGKILL");
          } catch {
            // Already gone.
          }
        }
      }
    }
    expect(renderTempDirs(outputDir)).not.toEqual([]);

    const job = createRenderJob({
      fps: 30,
      quality: "draft",
      hdrMode: "force-sdr",
      workers: 1,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      producerConfig: resolveConfig({ browserGpuMode: "software" }),
    });
    await executeRenderJob(job, join(root, "short"), join(outputDir, "next.mp4"));

    expect(renderTempDirs(outputDir)).toEqual([]);
    expect(existsSync(join(outputDir, "next.mp4"))).toBe(true);
  }, 300_000);
});
