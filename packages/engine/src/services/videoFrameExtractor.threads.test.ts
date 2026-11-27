import {
  chmodSync,
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
import type { VideoElement } from "../types.js";
import { FFMPEG_PATH_ENV, getFfmpegBinary } from "../utils/ffmpegBinaries.js";
import { runFfmpeg } from "../utils/runFfmpeg.js";

// A 32-CPU machine: 16 extraction slots.
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
  const previousFfmpeg = process.env[FFMPEG_PATH_ENV];

  beforeAll(() => {
    writeFileSync(
      shim,
      [
        "#!/bin/sh",
        `case " $* " in *" -i "*) ;; *) exec "${getFfmpegBinary()}" "$@" ;; esac`,
        // A run without thread flags takes ffmpeg's default: every CPU.
        'd="$HF_TEST_SHIM_DIR"; t=32; prev=',
        'for a in "$@"; do [ "$prev" = -filter_threads ] && t=$a; prev=$a; done',
        `printf '%s\\037' "$@" > "$d/args-$$"`,
        'echo "$t" > "$d/running/$$"',
        'cat "$d"/running/* | awk \'{ s += $1 } END { print s, NR }\' >> "$d/alive-threads"',
        // Hold each run until the expected number have started, so every one runs beside the others.
        'n=0; until [ "$(wc -l < "$d/alive-threads")" -ge "$HF_TEST_TOGETHER" ] || [ $n -ge 200 ]; do sleep 0.05; n=$((n+1)); done',
        `"${getFfmpegBinary()}" "$@"; rc=$?`,
        'rm -f "$d/running/$$"; exit $rc',
      ].join("\n"),
    );
    chmodSync(shim, 0o755);
  });

  afterAll(() => {
    delete process.env.HF_TEST_TOGETHER;
    if (previousFfmpeg === undefined) delete process.env[FFMPEG_PATH_ENV];
    else process.env[FFMPEG_PATH_ENV] = previousFfmpeg;
    rmSync(dir, { recursive: true, force: true });
  });

  /** Extracts `clips` through the shim; returns each run's thread counts and the threads alive as each started. */
  async function extractThroughShim(run: string, clips: number, seconds: number, fps: number) {
    const videos: VideoElement[] = [];
    for (let i = 0; i < clips; i++) {
      const src = join(dir, `${run}-${i}.mp4`);
      const made = await runFfmpeg([
        ...["-y", "-v", "error", "-f", "lavfi"],
        ...["-i", `testsrc=s=32x32:d=${seconds}:r=${fps},hue=h=${i * 60}`],
        ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", src],
      ]);
      expect(made.success, made.stderr).toBe(true);
      videos.push({
        ...{ id: `${run}-${i}`, src, start: 0, end: seconds, mediaStart: 0 },
        ...{ loop: false, hasAudio: false },
      });
    }
    const shimDir = join(dir, run);
    mkdirSync(join(shimDir, "running"), { recursive: true });
    process.env.HF_TEST_SHIM_DIR = shimDir;
    process.env[FFMPEG_PATH_ENV] = shim;
    try {
      const result = await extractAllVideoFrames(videos, dir, {
        fps,
        outputDir: join(shimDir, "out"),
      });
      expect(result.errors).toEqual([]);
    } finally {
      if (previousFfmpeg === undefined) delete process.env[FFMPEG_PATH_ENV];
      else process.env[FFMPEG_PATH_ENV] = previousFfmpeg;
      delete process.env.HF_TEST_SHIM_DIR;
    }
    const threads = readdirSync(shimDir)
      .filter((name) => name.startsWith("args-"))
      .map((name) => {
        const args = readFileSync(join(shimDir, name), "utf8").split("\x1f").filter(Boolean);
        const input = args.lastIndexOf("-i");
        return [
          ...valuesOf(args.slice(0, input), "-threads"),
          ...valuesOf(args.slice(input), "-threads"),
          ...valuesOf(args, "-filter_threads"),
        ];
      });
    const alive = readFileSync(join(shimDir, "alive-threads"), "utf8")
      .trim()
      .split("\n")
      .map((line) => line.split(" ").map(Number));
    const threadsPastTheBudget = alive.map(([threads = 0, runs = 0]) => threads - 32 - runs);
    return { threads, alive, threadsPastTheBudget };
  }

  it("leaves a lone clip in one segment to ffmpeg's own thread counts, as main does", async () => {
    process.env.HF_TEST_TOGETHER = "1";
    const { threads } = await extractThroughShim("lone", 1, 1, 10);
    expect(threads).toEqual([[]]);
  }, 60_000);

  // One 4K run measured 211 MB at 2 threads and 1057 MB at 32, so runs alive together split the CPUs.
  it("splits the CPUs between clips extracted together, a thread past the share each", async () => {
    process.env.HF_TEST_TOGETHER = "3";
    const { threads, alive, threadsPastTheBudget } = await extractThroughShim("three", 3, 1, 10);
    expect(threads).toEqual(Array(3).fill(Array(3).fill(String(Math.floor(32 / 3) + 1))));
    expect(alive).toHaveLength(3);
    expect(Math.max(...threadsPastTheBudget)).toBeLessThanOrEqual(0);
  }, 60_000);

  it("splits the CPUs between the segments of one long clip", async () => {
    process.env.HF_TEST_TOGETHER = "2";
    const { threads, threadsPastTheBudget } = await extractThroughShim("segments", 1, 125, 1);
    expect(threads).toEqual(Array(2).fill(Array(3).fill("17")));
    expect(Math.max(...threadsPastTheBudget)).toBeLessThanOrEqual(0);
  }, 60_000);
});
