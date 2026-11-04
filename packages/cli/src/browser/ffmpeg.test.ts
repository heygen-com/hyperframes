import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findFFmpeg, findFFprobe, H264EncoderUnavailableError } from "./ffmpeg.js";
import { runCancellableProcess } from "../utils/cancellableProcess.js";

// Only child_process is mocked, so no lookup shells out, while the wrapper
// tests below resolve via env overrides and need the real `existsSync`.
vi.mock("node:child_process", () => ({ execFileSync: vi.fn(), execSync: vi.fn() }));

// Only the distro probe is faked; `ffmpegInstallCommand` stays real so the
// linux cases below assert the string a user would actually be handed.
let linuxFamily = "debian";
vi.mock("./linuxDeps.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./linuxDeps.js")>()),
  detectLinuxDistro: () => ({ family: linuxFamily, isWsl: false, prettyName: null }),
}));

vi.mock("../utils/cancellableProcess.js", () => ({ runCancellableProcess: vi.fn() }));
const mockRun = vi.mocked(runCancellableProcess);

// The render's own GPU probe and the engine's must be one answer, so the encoder check asks the shared one.
const gpuProbes = vi.hoisted(() => ({
  shared: vi.fn(async () => "nvenc"),
  fresh: vi.fn(async () => "nvenc"),
}));
vi.mock("@hyperframes/engine", () => ({
  getCachedGpuEncoder: gpuProbes.shared,
  detectGpuEncoder: gpuProbes.fresh,
}));

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.HYPERFRAMES_FFMPEG_PATH;
  delete process.env.HYPERFRAMES_FFPROBE_PATH;
});

// Lookup mechanics (PATH scan, common-dir fallback, Windows shim preference)
// are covered by @hyperframes/parsers ffBinaries.test.ts. These tests pin the
// CLI wrapper's contract: a configured-but-missing override means "not found"
// so callers surface the install hint instead of a spawn error.
describe("findFFmpeg / findFFprobe", () => {
  it("returns undefined when the env override points at a missing file", () => {
    process.env.HYPERFRAMES_FFMPEG_PATH = join(tmpdir(), "missing-ffmpeg");
    process.env.HYPERFRAMES_FFPROBE_PATH = join(tmpdir(), "missing-ffprobe");

    expect(findFFmpeg()).toBeUndefined();
    expect(findFFprobe()).toBeUndefined();
  });

  it("returns the configured path when the env override exists", () => {
    process.env.HYPERFRAMES_FFMPEG_PATH = process.execPath;

    expect(findFFmpeg()).toBe(process.execPath);
  });
});

describe("resolveH264EncoderMode", () => {
  // The shape of an LGPL FFmpeg build: OpenH264 and VideoToolbox, no libx264.
  const noX264 = " V....D libopenh264 OpenH264\n V....D h264_videotoolbox VideoToolbox H.264\n";

  it("falls back to a GPU encoder that works when libx264 is absent", async () => {
    const { resolveH264EncoderMode } = await import("./ffmpeg.js");
    expect(resolveH264EncoderMode(noX264, false, true)).toBe("gpu");
  });

  it("refuses a compiled GPU encoder whose probe failed, with or without --gpu", async () => {
    const { resolveH264EncoderMode } = await import("./ffmpeg.js");
    expect(() => resolveH264EncoderMode(noX264, false, false)).toThrow(H264EncoderUnavailableError);
    expect(() => resolveH264EncoderMode(noX264, true, false)).toThrow(H264EncoderUnavailableError);
  });

  it("encodes --gpu renders with libx264 when no GPU encoder works", async () => {
    const { resolveH264EncoderMode } = await import("./ffmpeg.js");
    expect(resolveH264EncoderMode(" V....D libx264 H.264\n", true, false)).toBe("software");
    expect(resolveH264EncoderMode(" V....D libx264 H.264\n", true, true)).toBe("gpu");
  });

  it("prefers libx264 when both encoders are available", async () => {
    const { resolveH264EncoderMode } = await import("./ffmpeg.js");
    expect(
      resolveH264EncoderMode(
        " V....D libx264 H.264\n V....D h264_videotoolbox H.264\n",
        false,
        true,
      ),
    ).toBe("software");
  });

  it("says whether HEVC could still encode when H.264 cannot", async () => {
    const { resolveH264EncoderMode } = await import("./ffmpeg.js");
    const refusal = (encoders: string) => {
      try {
        resolveH264EncoderMode(encoders, false, false);
      } catch (error) {
        return error as InstanceType<typeof H264EncoderUnavailableError>;
      }
    };
    expect(refusal(" V....D libx265 HEVC\n")?.hevcEncoderAvailable).toBe(true);
    expect(refusal(noX264)?.hevcEncoderAvailable).toBe(false);
  });

  it("asks the configured FFmpeg, and probes the GPU only when libx264 is missing or --gpu is set", async () => {
    const { detectH264EncoderModeForRender } = await import("./ffmpeg.js");
    const signal = new AbortController().signal;
    const probeGpu = vi.fn(async () => null);
    mockRun.mockResolvedValue({ stdout: " V....D libx264 H.264\n" } as never);
    expect(await detectH264EncoderModeForRender("/custom/ffmpeg", false, signal, probeGpu)).toBe(
      "software",
    );
    expect(probeGpu).not.toHaveBeenCalled();
    expect(mockRun).toHaveBeenCalledWith(
      "/custom/ffmpeg",
      ["-hide_banner", "-encoders"],
      expect.objectContaining({ signal }),
    );

    mockRun.mockResolvedValue({ stdout: " V....D h264_videotoolbox H.264\n" } as never);
    await expect(
      detectH264EncoderModeForRender("/custom/ffmpeg", true, signal, probeGpu),
    ).rejects.toThrow(H264EncoderUnavailableError);
    expect(probeGpu).toHaveBeenCalledOnce();

    await expect(
      detectH264EncoderModeForRender("/custom/ffmpeg", true, signal, probeGpu),
    ).rejects.toThrow("/custom/ffmpeg has no libx264");

    mockRun.mockResolvedValue({ stdout: " V....D h264_nvenc H.264\n" } as never);
    expect(await detectH264EncoderModeForRender("/custom/ffmpeg", true, signal)).toBe("gpu");
    expect(gpuProbes.shared).toHaveBeenCalledOnce();
    expect(gpuProbes.fresh).not.toHaveBeenCalled();

    const timeout = new Error("ETIMEDOUT");
    mockRun.mockRejectedValueOnce(timeout);
    await expect(
      detectH264EncoderModeForRender("/custom/ffmpeg", false, signal, probeGpu),
    ).rejects.toThrow(timeout);
  });
});

// Studio renders the command behind a copy button, so "is there a command at
// all" has to be a typed answer rather than a guess made by pattern-matching
// the prose hint. The hint is derived from the command, so they move together.
describe("getFFmpegInstallCommand / getFFmpegInstallHint", () => {
  const realPlatform = process.platform;

  function setPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
  }

  afterEach(() => {
    setPlatform(realPlatform);
  });

  it("gives macOS a pasteable command and uses it verbatim as the hint", async () => {
    setPlatform("darwin");
    const { getFFmpegInstallCommand, getFFmpegInstallHint } = await import("./ffmpeg.js");

    expect(getFFmpegInstallCommand()).toBe("brew install ffmpeg");
    expect(getFFmpegInstallHint()).toBe("brew install ffmpeg");
  });

  it("gives Windows a winget command and keeps the manual route in the hint", async () => {
    setPlatform("win32");
    const { getFFmpegInstallCommand, getFFmpegInstallHint } = await import("./ffmpeg.js");

    const command = getFFmpegInstallCommand();
    expect(command).toBe("winget install --id Gyan.FFmpeg -e");
    // Machines predating winget still need somewhere to go.
    expect(getFFmpegInstallHint()).toContain(command);
    expect(getFFmpegInstallHint()).toContain("https://ffmpeg.org/download.html");
  });

  it("reports no command on a platform without one, and still hints", async () => {
    setPlatform("sunos");
    const { getFFmpegInstallCommand, getFFmpegInstallHint } = await import("./ffmpeg.js");

    expect(getFFmpegInstallCommand()).toBeUndefined();
    expect(getFFmpegInstallHint()).toBe("https://ffmpeg.org/download.html");
  });

  it("gives a recognised linux distro its package-manager command", async () => {
    setPlatform("linux");
    linuxFamily = "debian";
    const { getFFmpegInstallCommand } = await import("./ffmpeg.js");

    expect(getFFmpegInstallCommand()).toBe("sudo apt-get update && sudo apt-get install -y ffmpeg");
  });

  // The reason the command and the hint are separate functions at all. On an
  // unrecognised distro `ffmpegInstallCommand` returns a sentence, and Studio
  // renders whatever comes back inside a <code> block behind a Copy button —
  // so a command must be absent here, not prose. Without this the guard that
  // makes that true is unpinned, and deleting it keeps every other test green.
  it("reports no command on an unrecognised distro, and hints in prose", async () => {
    setPlatform("linux");
    linuxFamily = "unknown";
    const { getFFmpegInstallCommand, getFFmpegInstallHint } = await import("./ffmpeg.js");

    expect(getFFmpegInstallCommand()).toBeUndefined();
    expect(getFFmpegInstallHint()).toContain("distro package manager");
  });
});
