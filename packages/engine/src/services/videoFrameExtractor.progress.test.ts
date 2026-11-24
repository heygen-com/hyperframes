import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FFMPEG_PATH_ENV, getFfmpegBinary } from "../utils/ffmpegBinaries.js";
import { runFfmpeg } from "../utils/runFfmpeg.js";
import { extractVideoFramesRange } from "./videoFrameExtractor.js";

describe.skipIf(process.platform === "win32")("extraction progress", () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-extract-progress-"));
  const previousFfmpeg = process.env[FFMPEG_PATH_ENV];
  const shim = join(dir, "ffmpeg-shim.sh");

  beforeAll(() => {
    writeFileSync(
      shim,
      [
        "#!/bin/sh",
        `case " $* " in *" -i "*) ;; *) exec "${getFfmpegBinary()}" "$@" ;; esac`,
        "printf 'frame=    2 fps=1.0 time=00:00:02.00\\r' >&2",
        'until [ -f "$HF_TEST_SHIM_DIR/release" ]; do sleep 0.05; done',
        `exec "${getFfmpegBinary()}" "$@"`,
      ].join("\n"),
    );
    chmodSync(shim, 0o755);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reports frames while ffmpeg is still running", async () => {
    const clip = join(dir, "clip.mp4");
    const made = await runFfmpeg([
      ...["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=s=32x32:d=4:r=1"],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", clip],
    ]);
    expect(made.success, made.stderr).toBe(true);
    const run = join(dir, "run");
    mkdirSync(run, { recursive: true });
    process.env.HF_TEST_SHIM_DIR = run;
    process.env[FFMPEG_PATH_ENV] = shim;
    let planned = 0;
    let done = 0;
    try {
      const extraction = extractVideoFramesRange(clip, "clip", 0, 4, {
        fps: 1,
        outputDir: run,
        onProgress: (p) => {
          planned += p.planned ?? 0;
          done += p.done ?? 0;
        },
      });
      await vi.waitFor(() => expect(done).toBe(2), { timeout: 10_000 });
      expect(planned).toBe(4);
      writeFileSync(join(run, "release"), "");
      await extraction;
    } finally {
      writeFileSync(join(run, "release"), "");
      if (previousFfmpeg === undefined) delete process.env[FFMPEG_PATH_ENV];
      else process.env[FFMPEG_PATH_ENV] = previousFfmpeg;
      delete process.env.HF_TEST_SHIM_DIR;
    }
  }, 60_000);
});
