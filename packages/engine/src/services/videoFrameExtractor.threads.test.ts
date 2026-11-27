import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { VideoElement } from "../types.js";
import { FFMPEG_PATH_ENV, getFfmpegBinary } from "../utils/ffmpegBinaries.js";
import { runFfmpeg } from "../utils/runFfmpeg.js";

// A 32-CPU machine: 16 extraction slots, so each ffmpeg gets 2 threads.
vi.mock("./systemMemory.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./systemMemory.js")>()),
  usableCpuCount: () => 32,
  cpuBudget: () => 32,
}));

const { extractAllVideoFrames } = await import("./videoFrameExtractor.js");

/** The value after each `flag` in `args`, in order. */
function valuesOf(args: string[], flag: string): string[] {
  return args.flatMap((arg, i) => (arg === flag ? [args[i + 1] ?? ""] : []));
}

describe.skipIf(process.platform === "win32")("extraction ffmpeg threads", () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-extract-threads-"));
  const shim = join(dir, "ffmpeg-shim.sh");
  const calls = join(dir, "calls");
  const previousFfmpeg = process.env[FFMPEG_PATH_ENV];

  beforeAll(() => {
    writeFileSync(
      shim,
      [
        "#!/bin/sh",
        `case " $* " in *" -i "*) ;; *) exec "${getFfmpegBinary()}" "$@" ;; esac`,
        `printf '%s\\037' "$@" >> "${calls}"; echo >> "${calls}"`,
        `exec "${getFfmpegBinary()}" "$@"`,
      ].join("\n"),
    );
    chmodSync(shim, 0o755);
  });

  afterAll(() => {
    if (previousFfmpeg === undefined) delete process.env[FFMPEG_PATH_ENV];
    else process.env[FFMPEG_PATH_ENV] = previousFfmpeg;
    rmSync(dir, { recursive: true, force: true });
  });

  // Left to ffmpeg, each of the 16 runs starts a thread per core with frame buffers for each: 16 x 32 threads. On a
  // 4K source one run measured 211 MB at 2 threads and 1057 MB at 32.
  it("gives each extraction ffmpeg its share of the CPUs for decoding, filtering and encoding", async () => {
    const videos: VideoElement[] = [];
    for (const i of [0, 1, 2]) {
      const src = join(dir, `clip-${i}.mp4`);
      const made = await runFfmpeg([
        ...["-y", "-v", "error", "-f", "lavfi", "-i", `testsrc=s=64x64:d=1:r=10,hue=h=${i * 60}`],
        ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", src],
      ]);
      expect(made.success, made.stderr).toBe(true);
      videos.push({
        id: `clip-${i}`,
        src,
        start: 0,
        end: 1,
        mediaStart: 0,
        loop: false,
        hasAudio: false,
      });
    }
    mkdirSync(join(dir, "out"), { recursive: true });
    process.env[FFMPEG_PATH_ENV] = shim;
    const result = await extractAllVideoFrames(videos, dir, {
      fps: 10,
      outputDir: join(dir, "out"),
    });
    expect(result.errors).toEqual([]);

    const runs = readFileSync(calls, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("\x1f").filter(Boolean));
    expect(runs.length).toBeGreaterThanOrEqual(3);
    for (const args of runs) {
      const input = args.lastIndexOf("-i");
      expect(valuesOf(args.slice(0, input), "-threads")).toEqual(["2"]);
      expect(valuesOf(args.slice(input), "-threads")).toEqual(["2"]);
      expect(valuesOf(args, "-filter_threads")).toEqual(["2"]);
    }
  }, 60_000);
});
