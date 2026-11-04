import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getFfmpegBinary, getFfprobeBinary } from "../utils/ffmpegBinaries.js";
import {
  appendRateCapArgs,
  buildEncoderArgs,
  keyframeIntervalToGopSize,
  type EncoderOptions,
} from "./chunkEncoder.js";
import { buildStreamingArgs } from "./streamingEncoder.js";

const HAS_FFMPEG = spawnSync(getFfmpegBinary(), ["-version"], { encoding: "utf-8" }).status === 0;
const base = {
  fps: { num: 30, den: 1 },
  width: 320,
  height: 240,
  preset: "ultrafast",
};

const capOf = (args: string[]) =>
  args.slice(args.indexOf("-maxrate"), args.indexOf("-maxrate") + 4);

describe("keyframeIntervalToGopSize", () => {
  it("converts seconds to the nearest whole frame, never below one", () => {
    expect(keyframeIntervalToGopSize({ num: 30, den: 1 }, 2)).toBe(60);
    expect(keyframeIntervalToGopSize({ num: 30000, den: 1001 }, 2)).toBe(60);
    expect(keyframeIntervalToGopSize({ num: 24, den: 1 }, 0.01)).toBe(1);
  });
});

describe("GPU encoder args", () => {
  it("are the same in the disk and streaming builders, from the codec on", () => {
    const fromCodec = (args: string[]) => args.slice(args.indexOf("-c:v"));
    const opts = { ...base, useGpu: true, quality: 18 };
    for (const gpu of ["videotoolbox", "nvenc", "qsv", "vaapi", "amf"] as const) {
      expect(fromCodec(buildStreamingArgs(opts, "/tmp/o.mp4", gpu))).toEqual(
        fromCodec(buildEncoderArgs(opts, [], "/tmp/o.mp4", gpu)),
      );
    }
  });
});

describe("rate cap args", () => {
  it("adds nothing without maxBitrate", () => {
    expect(buildEncoderArgs(base, [], "/tmp/o.mp4")).not.toContain("-maxrate");
    expect(buildStreamingArgs(base, "/tmp/o.mp4")).not.toContain("-bufsize");
  });

  it("caps with a buffer of twice the rate by default, in both builders alike", () => {
    const opts = { ...base, maxBitrate: "8M" };
    expect(capOf(buildEncoderArgs(opts, [], "/tmp/o.mp4"))).toEqual([
      "-maxrate",
      "8000000",
      "-bufsize",
      "16000000",
    ]);
    expect(capOf(buildStreamingArgs(opts, "/tmp/o.mp4"))).toEqual(
      capOf(buildEncoderArgs(opts, [], "/tmp/o.mp4")),
    );
  });

  it("honours an explicit buffer and keeps CRF", () => {
    const args = buildEncoderArgs(
      { ...base, maxBitrate: "5000k", bufferSize: "2M", quality: 20 },
      [],
      "/tmp/o.mp4",
    );
    expect(capOf(args)).toEqual(["-maxrate", "5000000", "-bufsize", "2000000"]);
    expect(args[args.indexOf("-crf") + 1]).toBe("20");
  });

  it("reads a gigabit cap the way the HTTP parsers accept it", () => {
    expect(capOf(buildEncoderArgs({ ...base, maxBitrate: "1G" }, [], "/tmp/o.mp4"))).toEqual([
      "-maxrate",
      "1000000000",
      "-bufsize",
      "2000000000",
    ]);
  });

  it("refuses a buffer without a rate, a bad rate and codecs it cannot cap", () => {
    expect(() => appendRateCapArgs([], { bufferSize: "2M" })).toThrow(/requires maxBitrate/);
    expect(() => appendRateCapArgs([], { maxBitrate: "fast" })).toThrow(/invalid bitrate/);
    expect(() => appendRateCapArgs([], { maxBitrate: "0" })).toThrow(/positive/);
    for (const codec of ["vp9", "prores"] as const) {
      const opts: EncoderOptions = { ...base, codec, maxBitrate: "8M" };
      expect(() => buildEncoderArgs(opts, [], "/tmp/o.mov")).toThrow(/not supported for codec/);
      expect(() => buildStreamingArgs(opts, "/tmp/o.mov")).toThrow(/not supported for codec/);
    }
  });
});

describe.skipIf(!HAS_FFMPEG)("delivery options on a real encode", () => {
  const dir = mkdtempSync(join(tmpdir(), "delivery-opts-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  // High-entropy moving noise: unconstrained, x264 spends several Mbps on it.
  const input = [
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x240:rate=30:duration=8,noise=alls=60:allf=t",
  ];

  function encode(name: string, extra: Partial<EncoderOptions>): string {
    const out = join(dir, name);
    const args = buildEncoderArgs({ ...base, quality: 18, ...extra }, input, out);
    const run = spawnSync(getFfmpegBinary(), ["-v", "error"].concat(args), {
      encoding: "utf-8",
    });
    expect(run.status, run.stderr).toBe(0);
    return out;
  }

  const probe = (inputPath: string, args: readonly string[]): string => {
    const argv = ["-v", "error", ...args, "--", inputPath];
    return spawnSync(getFfprobeBinary(), argv, { encoding: "utf-8" }).stdout;
  };

  function packets(file: string): { time: number; bytes: number; key: boolean }[] {
    const out = probe(file, [
      "-select_streams",
      "v:0",
      "-show_entries",
      "packet=pts_time,size,flags",
      "-of",
      "csv=p=0",
    ]);
    return out
      .trim()
      .split("\n")
      .map((l) => l.split(","))
      .map(([time, size, flags]) => ({
        time: Number(time),
        bytes: Number(size),
        key: flags!.includes("K"),
      }))
      .sort((a, b) => a.time - b.time);
  }

  /** Worst excess of any packet window's bits over `rate * window + buffer`; <= 0 means the VBV bound holds. */
  function worstExcess(file: string, rate: number, buffer: number): number {
    const p = packets(file);
    let worst = -Infinity;
    for (let i = 0; i < p.length; i++) {
      let bits = 0;
      for (let j = i; j < p.length; j++) {
        bits += p[j]!.bytes * 8;
        worst = Math.max(worst, bits - (rate * (p[j]!.time - p[i]!.time + 1 / 30) + buffer));
      }
    }
    return worst;
  }

  it("puts a keyframe exactly every interval", () => {
    const file = encode("gop.mp4", {
      lockGopForChunkConcat: true,
      gopSize: keyframeIntervalToGopSize(base.fps, 2),
    });
    const keys = packets(file)
      .filter((x) => x.key)
      .map((x) => x.time);
    expect(keys).toEqual([0, 2, 4, 6]);
  });

  it("keeps the stream inside the VBV bound only when capped", () => {
    const rate = 600_000;
    const buffer = 2 * rate;
    expect(worstExcess(encode("free.mp4", {}), rate, buffer)).toBeGreaterThan(0);
    const capped = encode("capped.mp4", { maxBitrate: "600k" });
    expect(worstExcess(capped, rate, buffer)).toBeLessThanOrEqual(0);
  });
});
