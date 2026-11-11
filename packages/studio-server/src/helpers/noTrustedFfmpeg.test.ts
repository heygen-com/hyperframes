import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Which FFmpeg tools have a trusted install; the rest are missing, as on a machine without FFmpeg.
const trusted = vi.hoisted(() => ({ paths: {} as Record<string, string | undefined> }));
vi.mock("@hyperframes/parsers/ff-binaries", () => ({
  findFfBinary: (name: string) => trusted.paths[name],
  requireFfBinary: (name: string) => {
    const found = trusted.paths[name];
    if (found) return found;
    throw Object.assign(new Error(`[FFmpeg] ${name} not found.`), { code: "ENOENT" });
  },
}));

import { probeAudioTrack } from "./mediaMetadata.js";
import { decodePeakMap } from "./peakMap.js";
import { decodeAudioPeaks } from "./waveform.js";

describe.skipIf(process.platform === "win32")(
  "studio audio helpers without a trusted FFmpeg",
  () => {
    const originalPath = process.env.PATH;
    let root = "";
    let marker = "";

    function script(dir: string, name: string, body: string): string {
      const file = join(dir, name);
      writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
      return file;
    }

    // The project's node_modules/.bin leads PATH, as under `npm run`, and holds planted tools.
    beforeEach(() => {
      root = realpathSync(mkdtempSync(join(tmpdir(), "hf-studio-planted-")));
      marker = join(root, "ran");
      const bin = join(root, "project", "node_modules", ".bin");
      mkdirSync(bin, { recursive: true });
      for (const name of ["ffmpeg", "ffprobe"]) script(bin, name, `echo ${name} >> "${marker}"`);
      process.env.PATH = `${bin}${delimiter}${originalPath ?? ""}`;
      trusted.paths = {};
    });

    afterEach(() => {
      process.env.PATH = originalPath;
      rmSync(root, { recursive: true, force: true });
    });

    it("decodes no peaks rather than running the ffmpeg PATH finds by name", async () => {
      const tools = join(root, "tools");
      mkdirSync(tools);
      trusted.paths.ffprobe = script(
        tools,
        "ffprobe",
        `echo '{"streams":[{"codec_type":"audio","codec_name":"aac","channels":2}]}'`,
      );

      await expect(decodeAudioPeaks("clip.m4a")).rejects.toThrow(/ffmpeg not found/);
      await expect(decodePeakMap("clip.m4a")).rejects.toThrow(/ffmpeg not found/);
      expect(existsSync(marker)).toBe(false);
    });

    it("finds no audio track rather than running the ffprobe PATH finds by name", async () => {
      await expect(probeAudioTrack("clip.m4a")).resolves.toBeNull();
      expect(existsSync(marker)).toBe(false);
    });
  },
);
