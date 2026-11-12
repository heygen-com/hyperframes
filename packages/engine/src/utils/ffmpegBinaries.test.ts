import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  assertConfiguredFfmpegBinariesExist,
  getFfmpegBinary,
  getFfprobeBinary,
} from "./ffmpegBinaries.js";

describe("ffmpeg binary env resolution", () => {
  const originalFfmpegPath = process.env.HYPERFRAMES_FFMPEG_PATH;
  const originalFfprobePath = process.env.HYPERFRAMES_FFPROBE_PATH;
  const originalPath = process.env.PATH;

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("child_process");
    vi.doUnmock("@hyperframes/parsers/ff-binaries");
    if (originalFfmpegPath === undefined) delete process.env.HYPERFRAMES_FFMPEG_PATH;
    else process.env.HYPERFRAMES_FFMPEG_PATH = originalFfmpegPath;
    if (originalFfprobePath === undefined) delete process.env.HYPERFRAMES_FFPROBE_PATH;
    else process.env.HYPERFRAMES_FFPROBE_PATH = originalFfprobePath;
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  });

  it("uses configured absolute paths when env vars are set", () => {
    process.env.HYPERFRAMES_FFMPEG_PATH = "/tools/ffmpeg.exe";
    process.env.HYPERFRAMES_FFPROBE_PATH = "/tools/ffprobe.exe";

    expect(getFfmpegBinary()).toBe(resolve("/tools/ffmpeg.exe"));
    expect(getFfprobeBinary()).toBe(resolve("/tools/ffprobe.exe"));
  });

  it("throws a clear error when a configured FFmpeg path is missing", () => {
    process.env.HYPERFRAMES_FFMPEG_PATH = "/missing/ffmpeg.exe";

    expect(() => assertConfiguredFfmpegBinariesExist()).toThrow(
      /FFmpeg binary not found at HYPERFRAMES_FFMPEG_PATH/,
    );
  });

  it("accepts existing configured paths", () => {
    process.env.HYPERFRAMES_FFMPEG_PATH = process.execPath;
    process.env.HYPERFRAMES_FFPROBE_PATH = process.execPath;

    expect(() => assertConfiguredFfmpegBinariesExist()).not.toThrow();
  });

  it("calls out a mangled replacement character in configured binary paths", () => {
    process.env.HYPERFRAMES_FFMPEG_PATH = "/missing/ffmpeg�.exe";

    expect(() => assertConfiguredFfmpegBinariesExist()).toThrow(/replacement character|mangled/i);
  });

  describe.skipIf(process.platform === "win32")("with no trusted FFmpeg installed", () => {
    // A project's node_modules/.bin on PATH, as `npm run` and `npx` set it, holding planted tools.
    function plantTools(...names: string[]): { marker: string } {
      const project = realpathSync(mkdtempSync(join(tmpdir(), "hf-ff-planted-")));
      onTestFinished(() => rmSync(project, { recursive: true, force: true }));
      const bin = join(project, "node_modules", ".bin");
      mkdirSync(bin, { recursive: true });
      const marker = join(project, "ran");
      for (const name of names) {
        writeFileSync(join(bin, name), `#!/bin/sh\necho ${name} >> "${marker}"\n`, { mode: 0o755 });
      }
      delete process.env.HYPERFRAMES_FFMPEG_PATH;
      delete process.env.HYPERFRAMES_FFPROBE_PATH;
      process.env.PATH = `${bin}${delimiter}${originalPath ?? ""}`;
      vi.resetModules();
      vi.doMock("@hyperframes/parsers/ff-binaries", async (importOriginal) => {
        const actual = await importOriginal<typeof import("@hyperframes/parsers/ff-binaries")>();
        return { ...actual, findFfBinary: () => undefined };
      });
      return { marker };
    }

    it("reports ffmpeg as missing instead of running the one PATH finds by name", async () => {
      const { marker } = plantTools("ffmpeg");
      const { runFfmpeg } = await import("./runFfmpeg.js");
      const { getFfmpegBinary: binary } = await import("./ffmpegBinaries.js");
      expect(binary()).toMatch(/ffmpeg-not-found-set-HYPERFRAMES_FFMPEG_PATH[\\/]ffmpeg$/);

      const result = await runFfmpeg(["-version"]);

      expect(existsSync(marker)).toBe(false);
      expect(result).toMatchObject({ success: false, terminationReason: "spawn_error" });
      expect(result.error).toMatchObject({ code: "ENOENT" });
    });

    it("finds no GPU encoder rather than failing the probe", async () => {
      const { marker } = plantTools("ffmpeg");
      const { detectGpuEncoder } = await import("./gpuEncoder.js");

      await expect(detectGpuEncoder()).resolves.toBeNull();
      expect(existsSync(marker)).toBe(false);
    });

    it("fails a probe with the install hint instead of running the ffprobe PATH finds", async () => {
      const { marker } = plantTools("ffprobe");
      const { runFfprobe } = await import("./ffprobe.js");

      await expect(runFfprobe("/no/such/clip.mp4", ["-show_format"])).rejects.toThrow(
        /ffprobe not found/,
      );
      expect(existsSync(marker)).toBe(false);
    });
  });
});
