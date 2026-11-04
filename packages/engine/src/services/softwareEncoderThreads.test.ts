import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getFfmpegBinary } from "../utils/ffmpegBinaries.js";

const host = vi.hoisted(() => ({ quota: 6, cores: 8 }));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  availableParallelism: () => host.quota,
  cpus: () => Array.from({ length: host.cores }, () => ({}) as never),
}));

import { buildEncoderArgs } from "./chunkEncoder.js";
import type { EncoderOptions } from "./chunkEncoder.types.js";
import { appendSoftwareEncoderThreadsArg, X265_MAX_THREADS } from "./softwareEncoderThreads.js";
import { buildStreamingArgs } from "./streamingEncoder.js";

const FFMPEG = getFfmpegBinary();
const HAS_TASKSET = process.platform === "linux" && spawnSync("taskset", ["-V"]).status === 0;
const HAS_FFMPEG = spawnSync(FFMPEG, ["-version"]).status === 0;
const QUIET = ["-v", "error"];
const SOURCE = [
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=320x240:rate=30:duration=2,noise=alls=12:allf=t",
];

const options = (codec: "h264" | "h265"): EncoderOptions => ({
  fps: { num: 30, den: 1 },
  width: 320,
  height: 240,
  codec,
  preset: "medium",
  quality: 23,
});

const threadsOf = (args: string[]) => args[args.indexOf("-threads") + 1];

describe("software encoder thread count", () => {
  it("takes the CPU quota and floors at one", () => {
    const args: string[] = [];
    appendSoftwareEncoderThreadsArg(args, "libx264", 6.9);
    appendSoftwareEncoderThreadsArg(args, "libx264", 0);
    expect(args).toEqual(["-threads", "6", "-threads", "1"]);
  });

  it("caps libx265 at 16 threads and leaves libx264 uncapped", () => {
    const x265: string[] = [];
    const x264: string[] = [];
    appendSoftwareEncoderThreadsArg(x265, "libx265", 64);
    appendSoftwareEncoderThreadsArg(x264, "libx264", 64);
    expect([x265, x264]).toEqual([
      ["-threads", "16"],
      ["-threads", "64"],
    ]);
  });

  it.each(["h264", "h265"] as const)(
    "pins %s threads in both encoders to the quota, not the host",
    (codec) => {
      const seen = new Set<string | undefined>();
      for (const cores of [8, 16, 64]) {
        host.cores = cores;
        seen.add(threadsOf(buildEncoderArgs(options(codec), SOURCE, "out.mp4")));
        seen.add(
          threadsOf(
            buildStreamingArgs({ ...options(codec), preset: "medium" } as never, "out.mp4"),
          ),
        );
      }
      expect([...seen]).toEqual(["6"]);
    },
  );
});

describe.skipIf(!HAS_FFMPEG)("libx265 thread limit", () => {
  const encode = (threads: number) =>
    spawnSync(FFMPEG, [
      ...QUIET,
      ...SOURCE,
      "-frames:v",
      "4",
      "-c:v",
      "libx265",
      "-threads",
      String(threads),
      "-f",
      "null",
      "-",
    ]).status;

  it("rejects 17 threads and accepts the cap", () => {
    expect(encode(X265_MAX_THREADS + 1)).not.toBe(0);
    expect(encode(X265_MAX_THREADS)).toBe(0);
  }, 60_000);
});

describe.skipIf(!HAS_TASKSET || !HAS_FFMPEG)("encoded bytes across host sizes", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** Encode with the production args as a host with `cpus` cores would run them. */
  function videoMd5(codec: "h264", cpus: string): string {
    const dir = mkdtempSync(join(tmpdir(), "hf-threads-"));
    dirs.push(dir);
    const out = join(dir, "out.mp4");
    const args = buildEncoderArgs(options(codec), SOURCE, out);
    expect(spawnSync("taskset", ["-c", cpus, FFMPEG, ...QUIET, ...args]).status).toBe(0);
    const md5 = spawnSync(
      FFMPEG,
      ["-v", "error", "-i", out, "-map", "0:v", "-c", "copy", "-f", "md5", "-"],
      {
        encoding: "utf-8",
      },
    );
    return md5.stdout.trim();
  }

  // x265 output varies between runs even on one host, so only x264 can be held to identical bytes.
  it("gives h264 identical bytes on a 2-core and a 7-core host", () => {
    expect(videoMd5("h264", "0-1")).toBe(videoMd5("h264", "0-6"));
  }, 120_000);
});
