import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
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
const { extractVideoFramesRange } = await import("./videoFrameExtractor.js");

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
