// fallow-ignore-file code-duplication
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseToolVersion, runEnvironmentChecks } from "./preflight.js";
import * as manager from "./manager.js";
import * as linuxDeps from "./linuxDeps.js";

const execFileSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFileSync,
}));

describe("runEnvironmentChecks", () => {
  const originalFfmpegPath = process.env.HYPERFRAMES_FFMPEG_PATH;
  const originalFfprobePath = process.env.HYPERFRAMES_FFPROBE_PATH;

  beforeEach(() => {
    process.env.HYPERFRAMES_FFMPEG_PATH = process.execPath;
    process.env.HYPERFRAMES_FFPROBE_PATH = process.execPath;
    execFileSync.mockReturnValue("ffmpeg version 7.1.1\n");
  });

  afterEach(() => {
    if (originalFfmpegPath === undefined) delete process.env.HYPERFRAMES_FFMPEG_PATH;
    else process.env.HYPERFRAMES_FFMPEG_PATH = originalFfmpegPath;
    if (originalFfprobePath === undefined) delete process.env.HYPERFRAMES_FFPROBE_PATH;
    else process.env.HYPERFRAMES_FFPROBE_PATH = originalFfprobePath;
  });

  it("returns configured FFmpeg and FFprobe paths when checks pass", async () => {
    const result = await runEnvironmentChecks();

    expect(result.outcomes.find((outcome) => outcome.name === "FFmpeg")?.ok).toBe(true);
    expect(result.outcomes.find((outcome) => outcome.name === "FFprobe")?.ok).toBe(true);
    expect(result.ffmpegPath).toBe(process.execPath);
    expect(result.ffprobePath).toBe(process.execPath);
  });

  it("reports ffprobe as a render-blocking error when the explicit path is missing", async () => {
    process.env.HYPERFRAMES_FFPROBE_PATH = "/missing/ffprobe.exe";

    const result = await runEnvironmentChecks();

    expect(result.outcomes).toContainEqual(
      expect.objectContaining({
        name: "FFprobe",
        ok: false,
        level: "error",
        title: "FFprobe not found",
      }),
    );
    expect(result.ffprobePath).toBeUndefined();
  });

  it("fails early when an explicit FFmpeg env override points at a missing file", async () => {
    process.env.HYPERFRAMES_FFMPEG_PATH = "/missing/ffmpeg.exe";

    const result = await runEnvironmentChecks();
    const ffmpeg = result.outcomes.find((outcome) => outcome.name === "FFmpeg");

    expect(ffmpeg).toMatchObject({
      ok: false,
      detail: 'Configured path does not exist: HYPERFRAMES_FFMPEG_PATH="/missing/ffmpeg.exe"',
    });
  });

  it("blocks rendering when the selected FFmpeg binary cannot launch", async () => {
    execFileSync.mockImplementation((binaryPath: string) => {
      if (binaryPath !== process.env.HYPERFRAMES_FFMPEG_PATH) return "ffprobe version 7.1.1\n";
      throw Object.assign(new Error("Command failed with exit code 3221225781"), {
        status: 3221225781,
      });
    });

    const result = await runEnvironmentChecks();
    const ffmpeg = result.outcomes.find((outcome) => outcome.name === "FFmpeg");

    expect(ffmpeg).toMatchObject({
      ok: false,
      level: "error",
      title: "FFmpeg cannot start",
      path: process.execPath,
    });
    expect(ffmpeg?.detail).toContain(process.execPath);
    expect(ffmpeg?.detail).toContain("3221225781");
    expect(ffmpeg?.hint).toContain("working 64-bit FFmpeg build");
    expect(result.ffmpegPath).toBeUndefined();
  });

  it("validates an explicit browser path without needing browser discovery", async () => {
    const result = await runEnvironmentChecks({
      includeBrowser: true,
      browserPath: process.execPath,
    });

    expect(result.outcomes.find((outcome) => outcome.name === "Chrome")).toMatchObject({
      ok: true,
      path: process.execPath,
    });
  });

  it("reports Chrome as not found (no throw) when browser discovery throws on a corrupt cache", async () => {
    const spy = vi.spyOn(manager, "findBrowser").mockRejectedValue(
      Object.assign(new Error("ENOTDIR: not a directory, scandir 'chrome-headless-shell'"), {
        code: "ENOTDIR",
      }),
    );

    try {
      const result = await runEnvironmentChecks({ includeBrowser: true });

      expect(result.outcomes.find((outcome) => outcome.name === "Chrome")).toMatchObject({
        ok: false,
        title: "Chrome not found",
        hint: "Run: npx hyperframes browser ensure",
      });
      expect(result.browser).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  it("reports an explicit missing browser path before render starts", async () => {
    const result = await runEnvironmentChecks({
      includeBrowser: true,
      browserPath: "/missing/chrome-headless-shell.exe",
    });

    expect(result.outcomes.find((outcome) => outcome.name === "Chrome")).toMatchObject({
      ok: false,
      title: "Chrome not found",
    });
  });
});

describe("runEnvironmentChecks — Chrome shared libraries (Linux/WSL)", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    vi.restoreAllMocks();
  });

  it("downgrades a found Chrome to a render-blocking error when libs are missing", async () => {
    vi.spyOn(manager, "findBrowser").mockResolvedValue({
      executablePath: "/root/.cache/hyperframes/chrome-headless-shell",
      source: "cache",
    });
    vi.spyOn(linuxDeps, "probeChromeSharedLibs").mockReturnValue({
      ok: false,
      missing: ["libnss3.so", "libatk-1.0.so.0"],
      probeUnavailable: false,
    });
    vi.spyOn(linuxDeps, "detectLinuxDistro").mockReturnValue({
      family: "debian",
      id: "ubuntu",
      prettyName: "Ubuntu 22.04.3 LTS",
      isWsl: true,
    });

    const result = await runEnvironmentChecks({ includeBrowser: true });
    const chrome = result.outcomes.find((o) => o.name === "Chrome");

    expect(chrome).toMatchObject({
      ok: false,
      level: "error",
      title: "Chrome cannot launch (missing system libraries)",
    });
    expect(chrome?.detail).toContain("WSL");
    expect(chrome?.detail).toContain("libnss3.so");
    expect(chrome?.hint).toContain("apt-get install -y");
    expect(chrome?.hint).toContain("libnss3");
    // A lib-broken Chrome must NOT be handed to the render pipeline as usable.
    expect(result.browser).toBeUndefined();
  });

  it("keeps Chrome ok when the shared-lib probe passes", async () => {
    vi.spyOn(manager, "findBrowser").mockResolvedValue({
      executablePath: "/usr/bin/chromium",
      source: "system",
    });
    vi.spyOn(linuxDeps, "probeChromeSharedLibs").mockReturnValue({
      ok: true,
      missing: [],
      probeUnavailable: false,
    });

    const result = await runEnvironmentChecks({ includeBrowser: true });
    expect(result.outcomes.find((o) => o.name === "Chrome")).toMatchObject({ ok: true });
    expect(result.browser?.executablePath).toBe("/usr/bin/chromium");
  });

  it("keeps Chrome ok when the probe is inconclusive (no ldd)", async () => {
    vi.spyOn(manager, "findBrowser").mockResolvedValue({
      executablePath: "/usr/bin/chromium",
      source: "system",
    });
    vi.spyOn(linuxDeps, "probeChromeSharedLibs").mockReturnValue({
      ok: false,
      missing: [],
      probeUnavailable: true,
    });

    const result = await runEnvironmentChecks({ includeBrowser: true });
    expect(result.outcomes.find((o) => o.name === "Chrome")).toMatchObject({ ok: true });
  });
});

describe("parseToolVersion", () => {
  it("extracts ffprobe versions with Windows build suffixes", () => {
    expect(parseToolVersion("ffprobe version 7.1.1-essentials_build-www.gyan.dev Copyright")).toBe(
      "ffprobe 7.1.1-essentials_build-www.gyan.dev",
    );
  });
});
