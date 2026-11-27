import { expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpegCwd } from "@hyperframes/parsers/ff-binaries";
import { resolveConfig } from "@hyperframes/engine";
import { createRenderJob, executeRenderJob } from "./renderOrchestrator.js";

const seen = vi.hoisted(() => ({ cwd: "not reached" as string | undefined }));

vi.mock("./render/stages/compileStage.js", async () => {
  const { ffmpegCwd: cwdInStage } = await import("@hyperframes/parsers/ff-binaries");
  return {
    runCompileStage: async () => {
      seen.cwd = cwdInStage();
      throw new Error("stop after compile");
    },
  };
});

it("runs a render's ffmpeg and ffprobe from an empty folder, and leaves other callers' folder alone", async () => {
  const root = mkdtempSync(join(tmpdir(), "hf-empty-folder-render-"));
  try {
    writeFileSync(join(root, "index.html"), "<div></div>");
    const job = createRenderJob({
      fps: 30,
      quality: "draft",
      format: "mp4",
      hdrMode: "force-sdr",
      producerConfig: resolveConfig({ enablePageSideCompositing: false }),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    });
    await expect(executeRenderJob(job, root, join(root, "out.mp4"))).rejects.toThrow(
      "stop after compile",
    );
    expect(seen.cwd).toBeDefined();
    expect(seen.cwd).not.toBe(process.cwd());
    expect(readdirSync(seen.cwd!)).toEqual([]);
    expect(ffmpegCwd()).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
