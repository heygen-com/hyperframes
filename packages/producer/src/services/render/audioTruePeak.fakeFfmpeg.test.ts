import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  encodeAac,
  extractAudioMetadata,
  runFfmpeg,
  type RunFfmpegResult,
} from "@hyperframes/engine";
import { constrainAacTruePeak, padOrTrimAudioToVideoFrameCount } from "./audioPadTrim.js";
import { measureTruePeakDbfs } from "./audioTruePeak.js";

vi.mock("@hyperframes/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hyperframes/engine")>()),
  encodeAac: vi.fn(),
  extractAudioMetadata: vi.fn(),
  runFfmpeg: vi.fn(),
}));

const FRAME =
  "[Parsed_ebur128_0 @ 0x1] t: 0.1 M:-20.0 S:-20.0 I:-20.0 LUFS FTPK: -3.0 dBFS TPK: -3.0 dBFS";
const SUMMARY = "  True peak:\n    Peak:        -3.0 dBFS";
const ran = (success: boolean, stderr: string): RunFfmpegResult => ({
  success,
  exitCode: success ? 0 : 1,
  stderr,
  durationMs: 1,
  terminationReason: "exit",
});
const probed = (durationSeconds: number, sampleRate: number) =>
  vi.mocked(extractAudioMetadata).mockResolvedValue({
    durationSeconds,
    sampleRate,
    channels: 2,
    audioCodec: "aac",
  });
const scanFilters = () =>
  vi
    .mocked(runFfmpeg)
    .mock.calls.map(([args]) => args.find((arg) => arg.includes("ebur128")))
    .filter(Boolean);

beforeEach(() => probed(180, 48_000));
afterEach(() => {
  vi.mocked(runFfmpeg).mockReset();
  vi.mocked(encodeAac).mockReset();
});

describe("measureTruePeakDbfs against ffmpeg's stderr", () => {
  it("throws when ffmpeg prints no true-peak summary", async () => {
    vi.mocked(runFfmpeg).mockImplementation(async (_, opts) => {
      opts?.onStderr?.(`${FRAME}\n`);
      return ran(true, FRAME);
    });
    probed(30, 48_000);
    await expect(measureTruePeakDbfs("in.m4a", { timeoutMs: 1000 })).rejects.toThrow(
      "FFmpeg did not report AAC true peak",
    );
  });

  it("measures a rate other than 48 kHz in one whole-file pass", async () => {
    vi.mocked(runFfmpeg).mockResolvedValue(ran(true, `${FRAME}\n${SUMMARY}`));
    probed(180, 44_100);
    const peak = await measureTruePeakDbfs("in.m4a", { timeoutMs: 1000 });
    expect(peak).toBe(-3);
    expect(scanFilters()).toEqual(["ebur128=peak=true"]);
  });

  it("measures a file of unknown length in one whole-file pass", async () => {
    vi.mocked(runFfmpeg).mockResolvedValue(ran(true, `${FRAME}\n${SUMMARY}`));
    probed(Number.NaN, 48_000);
    expect(await measureTruePeakDbfs("in.m4a", { timeoutMs: 1000 })).toBe(-3);
    expect(scanFilters()).toEqual(["ebur128=peak=true"]);
  });

  it("stops the other segment scans when one fails", async () => {
    const others: (AbortSignal | undefined)[] = [];
    vi.mocked(runFfmpeg).mockImplementation(async (args, opts) => {
      if (args.some((arg) => arg.startsWith("atrim=start_sample=0:"))) return ran(false, "boom");
      others.push(opts?.signal);
      const signal = opts?.signal;
      if (signal) await new Promise((stop) => signal.addEventListener("abort", stop));
      return ran(false, "stopped");
    });
    await expect(measureTruePeakDbfs("in.m4a", { timeoutMs: 1000 })).rejects.toThrow();
    expect(others.map((signal) => signal?.aborted)).toEqual([true, true]);
  });
});

describe("a local render's audio pad/trim", () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-pad-trim-peak-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("checks the true peak in the same parallel segments as the distributed plan", async () => {
    vi.mocked(runFfmpeg).mockResolvedValue(ran(true, `${FRAME}\n${SUMMARY}`));
    const result = await padOrTrimAudioToVideoFrameCount({
      videoPath: join(dir, "video.mp4"),
      audioPath: join(dir, "audio.m4a"),
      outputPath: join(dir, "audio.duration-normalized.m4a"),
      probeVideoFrameInfo: async () => ({ frameCount: 5400, fpsNum: 30, fpsDen: 1 }),
      probeAudioInfo: async () => ({ durationSeconds: 180 }),
    });
    expect(result.success).toBe(true);
    expect(scanFilters()).toEqual([
      "atrim=start_sample=0:end_sample=2880000,ebur128=peak=true",
      "atrim=start_sample=91200:end_sample=2976000,ebur128=peak=true",
      "atrim=start_sample=91200,ebur128=peak=true",
    ]);
    const seeks = vi
      .mocked(runFfmpeg)
      .mock.calls.filter(([args]) => args.some((arg) => arg.includes("ebur128")))
      .map(([args]) => (args[0] === "-ss" ? args[1] : null));
    expect(seeks).toEqual([null, "58", "118"]);
  });
});

describe("the true-peak correction", () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-peak-correct-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  async function correctHotAudio(sourcePath?: string) {
    const scan = (dbfs: string) =>
      ran(true, `${FRAME.replaceAll("-3.0", dbfs)}\n${SUMMARY.replace("-3.0", dbfs)}`);
    vi.mocked(runFfmpeg).mockImplementation(async (args, opts) => {
      const result = scan(args.some((arg) => arg.includes(".true-peak-")) ? "-1.6" : "-0.3");
      opts?.onStderr?.(result.stderr);
      return result;
    });
    vi.mocked(encodeAac).mockImplementation(async (_input, output) => {
      writeFileSync(output, "corrected");
      return ran(true, "");
    });
    const audioPath = join(dir, "audio.m4a");
    writeFileSync(audioPath, "mixed");
    const result = await constrainAacTruePeak({
      audioPath,
      ...(sourcePath ? { sourcePath } : {}),
      targetDurationSeconds: 180,
      timeoutMs: 1000,
    });
    expect(result).toEqual({ success: true, loweredDb: 1.2 });
    expect(vi.mocked(encodeAac)).toHaveBeenCalledTimes(1);
    return { audioPath, call: vi.mocked(encodeAac).mock.calls[0]! };
  }

  it("re-encodes the plan's PCM mix, not the AAC, in the encoder's parallel segments", async () => {
    const sourcePath = join(dir, "mix.wav");
    const { call } = await correctHotAudio(sourcePath);
    expect(call[0]).toBe(sourcePath);
    expect(call[3]).toEqual({
      signal: undefined,
      timeout: 1000,
      filter: expect.stringMatching(/^volume=-1\.200dB,/),
    });
  });

  it("re-encodes an AAC without its PCM in one encoder, not decoded again per segment", async () => {
    const { audioPath, call } = await correctHotAudio();
    expect(call[0]).toBe(audioPath);
    expect(call[3]).toMatchObject({ segments: 1 });
  });
});
