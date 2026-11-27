import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/runFfmpeg.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../utils/runFfmpeg.js")>();
  return { ...real, runFfmpeg: vi.fn(real.runFfmpeg) };
});
const probe = vi.hoisted(() => ({ hasVideoToolbox: true }));
vi.mock("../utils/psnrFilterAvailability.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/psnrFilterAvailability.js")>()),
  isFfmpegHwaccelAvailable: async () => probe.hasVideoToolbox,
}));

const { runFfmpeg } = await import("../utils/runFfmpeg.js");
const { extractAllVideoFrames, extractVideoFramesRange } = await import("./videoFrameExtractor.js");

describe.skipIf(process.platform === "win32")("extraction decode on the Mac's media engine", () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-extract-media-engine-"));
  const realPlatform = process.platform;
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  const clips = { h264: join(dir, "h264.mp4"), vp9: join(dir, "vp9.webm") };

  beforeAll(async () => {
    for (const [clip, codec] of [
      [clips.h264, ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"]],
      [clips.vp9, ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-pix_fmt", "yuv420p"]],
    ] as const) {
      const made = await runFfmpeg([
        ...["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=64x64:d=1:r=10", ...codec, clip],
      ]);
      expect(made.success, made.stderr).toBe(true);
    }
  });

  beforeEach(() => {
    vi.mocked(runFfmpeg).mockClear();
    probe.hasVideoToolbox = true;
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** Extracts on `os`, returning the extraction's ffmpeg args and frames. */
  async function extractOn(os: NodeJS.Platform, clip: string, id: string) {
    Object.defineProperty(process, "platform", { ...platform, value: os });
    let frames: string[] = [];
    try {
      const out = join(dir, id);
      await extractVideoFramesRange(clip, id, 0, 1, { fps: 10, outputDir: dir }, undefined, {}, out)
        .then(
          () =>
            (frames = readdirSync(out)
              .sort()
              .map((name) => join(out, name))),
        )
        .catch((error: unknown) => {
          // Off a Mac, an ffmpeg asked for VideoToolbox fails; the args are what is checked there.
          if (realPlatform === "darwin" || os !== "darwin") throw error;
        });
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
    const args = vi
      .mocked(runFfmpeg)
      .mock.calls.map(([callArgs]) => callArgs)
      .find((callArgs) => callArgs.includes(clip) && callArgs.includes("-vf"))!;
    return { args, frames };
  }

  const hwaccel = (args: string[]) =>
    args.includes("-hwaccel") ? args[args.indexOf("-hwaccel") + 1] : null;

  it("decodes on the media engine on macOS when this ffmpeg has VideoToolbox", async () => {
    const { args } = await extractOn("darwin", clips.h264, "mac");
    expect(hwaccel(args)).toBe("videotoolbox");
  });

  it("decodes in software when this ffmpeg has no VideoToolbox", async () => {
    probe.hasVideoToolbox = false;
    const { args } = await extractOn("darwin", clips.h264, "mac-no-vt");
    expect(hwaccel(args)).toBeNull();
  });

  it("keeps the software decoder for a codec that may carry alpha", async () => {
    const { args } = await extractOn("darwin", clips.vp9, "mac-vp9");
    expect(hwaccel(args)).toBeNull();
  });

  it("never asks for VideoToolbox off macOS", async () => {
    const { args } = await extractOn("linux", clips.h264, "linux");
    expect(hwaccel(args)).toBeNull();
  });

  it("gives a failed decode's last stderr lines without its paths or URLs", async () => {
    probe.hasVideoToolbox = false;
    // With spaces in the name, only the exact path hides all of it.
    const clip = join(dir, "Screen Recording 1.mp4");
    copyFileSync(clips.h264, clip);
    const signed = "https://media.example.com/clip.mp4?X-Amz-Signature=0123abcd";
    const stderr = [
      "[h264 @ 0x2] Invalid NAL unit size (1714 > 1100).",
      `[https @ 0x1] Opening '${signed}' for reading`,
      `${clip}: Invalid data found when processing input`,
      "Error opening output C:\\Users\\someone\\frames\\frame_%05d.jpg",
    ].join("\n");
    const real = vi.mocked(runFfmpeg).getMockImplementation()!;
    vi.mocked(runFfmpeg).mockImplementation(async (args, options) =>
      args.includes("-vf")
        ? { success: false, exitCode: 1, stderr, durationMs: 1, terminationReason: "exit" }
        : real(args, options),
    );
    let errors: Awaited<ReturnType<typeof extractAllVideoFrames>>["errors"] = [];
    try {
      const video = { id: "failed", src: clip, start: 0, end: 1, mediaStart: 0 };
      ({ errors } = await extractAllVideoFrames([{ ...video, loop: false, hasAudio: false }], dir, {
        fps: 10,
        outputDir: join(dir, "failed"),
      }));
    } finally {
      vi.mocked(runFfmpeg).mockImplementation(real);
    }
    expect(errors.map((failure) => failure.kind)).toEqual(["ffmpeg_failed"]);
    expect(errors[0]?.ffmpegReason).toBe(
      "[https @ 0x1] Opening '<url>' for reading | <path>: Invalid data found when processing input | Error opening output <path>",
    );
  });

  it("gives the lines ffmpeg said why in, not its closing summary", async () => {
    probe.hasVideoToolbox = false;
    // A folder where frame 3 goes: ffmpeg writes 2 frames, says it could not open the file, then sums up.
    const out = join(dir, "blocked");
    mkdirSync(join(out, "frame_00003.jpg"), { recursive: true });
    const failure = await extractVideoFramesRange(
      clips.h264,
      "blocked",
      0,
      1,
      { fps: 10, outputDir: dir, format: "jpg" },
      undefined,
      {},
      out,
    ).catch((error: unknown) => error as { ffmpegReason?: string });
    const lines = failure.ffmpegReason?.split(" | ") ?? [];
    expect(lines[0]).toMatch(/^\[image2 @ \w+\] Could not open file : <path>/);
    expect(lines.at(-1)).toMatch(/\] Error muxing a packet$/);
  });

  it("keeps ffmpeg's last lines when it said nothing but its summary", async () => {
    probe.hasVideoToolbox = false;
    const stderr = [
      "ffmpeg version 6.1.1 Copyright (c) 2000-2023 the FFmpeg developers",
      "  built with gcc 13.3.0",
      "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mp4':",
      "Stream mapping:",
      "  Stream #0:0 -> #0:0 (h264 (native) -> mjpeg (native))",
      "Press [q] to stop, [?] for help",
      "[out#0/image2 @ 0x2] video:12kB audio:0kB subtitle:0kB other streams:0kB global headers:0kB muxing overhead: unknown",
      "frame=    1 fps=0.3 q=2.0 Lsize=N/A time=00:00:00.03 bitrate=N/A speed=0.0111x    ",
      "Conversion failed!",
    ].join("\n");
    const real = vi.mocked(runFfmpeg).getMockImplementation()!;
    vi.mocked(runFfmpeg).mockImplementation(async (args, options) =>
      args.includes("-vf")
        ? { success: false, exitCode: 1, stderr, durationMs: 1, terminationReason: "exit" }
        : real(args, options),
    );
    const failure = await extractVideoFramesRange(
      clips.h264,
      "summary",
      0,
      1,
      { fps: 10, outputDir: dir },
      undefined,
      {},
      join(dir, "summary"),
    )
      .catch((error: unknown) => error as { ffmpegReason?: string })
      .finally(() => vi.mocked(runFfmpeg).mockImplementation(real));
    expect(failure.ffmpegReason).toMatch(/video:12kB .* \| frame= .* \| Conversion failed!$/);
  });

  it("calls an extraction that filled the disk disk_full, not a source that cannot be decoded", async () => {
    probe.hasVideoToolbox = false;
    // ffmpeg 8's own words when its frames fill the disk (exit 228); the summary after them is all a tail shows.
    const stderr = [
      "[vost#0:0/mjpeg @ 0x1] Error submitting a packet to the muxer: No space left on device",
      "[out#0/image2 @ 0x2] Error muxing a packet",
      "[out#0/image2 @ 0x2] Task finished with error code: -28 (No space left on device)",
      "[out#0/image2 @ 0x2] Terminating thread with return code -28 (No space left on device)",
      "[out#0/image2 @ 0x2] video:40374KiB audio:0KiB subtitle:0KiB other streams:0KiB global headers:0KiB",
      "frame=  307 fps=124 q=2.0 Lsize=N/A time=00:00:10.23 bitrate=N/A speed=4.14x",
      "Conversion failed!",
    ].join("\n");
    const real = vi.mocked(runFfmpeg).getMockImplementation()!;
    vi.mocked(runFfmpeg).mockImplementation(async (args, options) =>
      args.includes("-vf")
        ? { success: false, exitCode: 228, stderr, durationMs: 1, terminationReason: "exit" }
        : real(args, options),
    );
    let errors: Awaited<ReturnType<typeof extractAllVideoFrames>>["errors"] = [];
    try {
      const video = { id: "full", src: clips.h264, start: 0, end: 1, mediaStart: 0 };
      ({ errors } = await extractAllVideoFrames([{ ...video, loop: false, hasAudio: false }], dir, {
        fps: 10,
        outputDir: join(dir, "full"),
      }));
    } finally {
      vi.mocked(runFfmpeg).mockImplementation(real);
    }
    expect(errors.map(({ kind, retryable }) => ({ kind, retryable }))).toEqual([
      { kind: "disk_full", retryable: false },
    ]);
  });

  it("decodes in software when the media engine refuses a picture", async () => {
    const real = vi.mocked(runFfmpeg).getMockImplementation()!;
    vi.mocked(runFfmpeg).mockImplementation(async (args, options) =>
      args.includes("-hwaccel")
        ? {
            success: false,
            exitCode: 69,
            stderr: "[h264 @ 0x1] hardware accelerator failed to decode picture",
            durationMs: 0,
            terminationReason: "exit",
          }
        : real(args, options),
    );
    try {
      const { frames } = await extractOn("darwin", clips.h264, "mac-vt-refuses");
      const runs = vi.mocked(runFfmpeg).mock.calls.map(([callArgs]) => hwaccel(callArgs));
      expect(runs).toEqual(["videotoolbox", null]);
      expect(frames).toHaveLength(10);
    } finally {
      vi.mocked(runFfmpeg).mockImplementation(real);
    }
  });

  it("does not decode again in software when the media engine's pass filled the disk", async () => {
    const real = vi.mocked(runFfmpeg).getMockImplementation()!;
    vi.mocked(runFfmpeg).mockImplementation(async (args, options) =>
      args.includes("-hwaccel")
        ? {
            success: false,
            exitCode: 228,
            stderr:
              "[out#0/image2 @ 0x2] Task finished with error code: -28 (No space left on device)",
            durationMs: 0,
            terminationReason: "exit",
          }
        : real(args, options),
    );
    try {
      await extractOn("darwin", clips.h264, "mac-vt-disk-full").catch(() => {});
      const runs = vi.mocked(runFfmpeg).mock.calls.map(([callArgs]) => hwaccel(callArgs));
      expect(runs).toEqual(["videotoolbox"]);
    } finally {
      vi.mocked(runFfmpeg).mockImplementation(real);
    }
  });

  it.runIf(realPlatform === "darwin")("writes the same frames as software decode", async () => {
    const engine = await extractOn("darwin", clips.h264, "same-engine");
    probe.hasVideoToolbox = false;
    const software = await extractOn("darwin", clips.h264, "same-software");
    expect(hwaccel(engine.args)).toBe("videotoolbox");
    expect(engine.frames).toHaveLength(10);
    expect(engine.frames.map((f) => readFileSync(f))).toEqual(
      software.frames.map((f) => readFileSync(f)),
    );
  });
});
