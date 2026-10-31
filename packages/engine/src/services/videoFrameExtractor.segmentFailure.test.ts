import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FFMPEG_PATH_ENV, getFfmpegBinary } from "../utils/ffmpegBinaries.js";
import { runFfmpeg } from "../utils/runFfmpeg.js";

// Four CPUs: two extraction slots.
vi.mock("os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("os")>()),
  cpus: () => [{}, {}, {}, {}],
}));

const { extractVideoFramesRange } = await import("./videoFrameExtractor.js");

describe.skipIf(process.platform === "win32")("a failed segment of a split range", () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-extract-segment-failure-"));
  const previousFfmpeg = process.env[FFMPEG_PATH_ENV];
  const shim = join(dir, "ffmpeg-shim.sh");

  async function synth(name: string, seconds: number): Promise<string> {
    const clip = join(dir, `${name}.mp4`);
    const made = await runFfmpeg([
      ...["-y", "-v", "error", "-f", "lavfi", "-i", `testsrc=s=32x32:d=${seconds}:r=1`],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-g", "10", "-pix_fmt", "yuv420p", clip],
    ]);
    expect(made.success, made.stderr).toBe(true);
    return clip;
  }

  beforeAll(() => {
    writeFileSync(
      shim,
      [
        "#!/bin/sh",
        `case " $* " in *" -i "*) ;; *) exec "${getFfmpegBinary()}" "$@" ;; esac`,
        'echo 1 >> "$HF_TEST_SHIM_DIR/alive"',
        'case "$*" in *failing-*) exit 1 ;; esac',
        'case "$*" in *held-*) until [ -f "$HF_TEST_SHIM_DIR/release" ] || [ ! -d "$HF_TEST_SHIM_DIR" ]; do sleep 0.05; done ;; esac',
        `exec "${getFfmpegBinary()}" "$@"`,
      ].join("\n"),
    );
    chmodSync(shim, 0o755);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reports its own failure, not a cancel of the segments it stopped", async () => {
    const [held, failing] = await Promise.all([synth("held-0", 2), synth("failing-0", 260)]);
    const run = join(dir, "run");
    mkdirSync(run, { recursive: true });
    process.env.HF_TEST_SHIM_DIR = run;
    process.env[FFMPEG_PATH_ENV] = shim;
    try {
      const holder = extractVideoFramesRange(held, "held", 0, 1, { fps: 1, outputDir: run });
      await vi.waitFor(() => expect(readFileSync(join(run, "alive"), "utf8").trim()).toBe("1"), {
        timeout: 10_000,
      });
      const range = extractVideoFramesRange(failing, "failing", 0, 250, { fps: 1, outputDir: run });
      await expect(range).rejects.toThrow(/could not be decoded/);
      writeFileSync(join(run, "release"), "");
      await holder;
    } finally {
      writeFileSync(join(run, "release"), "");
      if (previousFfmpeg === undefined) delete process.env[FFMPEG_PATH_ENV];
      else process.env[FFMPEG_PATH_ENV] = previousFfmpeg;
      delete process.env.HF_TEST_SHIM_DIR;
    }
  }, 60_000);
});
