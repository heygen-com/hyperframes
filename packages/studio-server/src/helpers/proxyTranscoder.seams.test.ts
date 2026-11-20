import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { afterEach, describe, expect, it, vi } from "vitest";

const realFfmpeg = findFfBinary("ffmpeg");
// Three 15 s pieces (PROXY_CHUNK_SECONDS in proxyTranscoder.ts), the last taking the remainder.
const LONG_SECONDS = 50;

const tempDirs: string[] = [];
function tmpProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-proxy-seams-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.resetModules();
});

describe("resolveProxy keeping picture and sound together across the seams of a long source", () => {
  const realCopyOf = async (name: string, makeSource: (path: string) => void) => {
    vi.resetModules();
    vi.doUnmock("./mediaMetadata.js");
    vi.doMock("@hyperframes/core/preview-proof", () => ({ previewToken: () => "a".repeat(64) }));
    const { resolveProxy } = await import("./proxyTranscoder.js");
    const projectDir = realpathSync(tmpProject());
    const sourcePath = join(projectDir, name);
    makeSource(sourcePath);
    return { sourcePath, proxyPath: await resolveProxy(projectDir, sourcePath) };
  };
  const probeJson = (path: string, entries: string) =>
    JSON.parse(
      execFileSync(
        findFfBinary("ffprobe")!,
        ["-v", "error", "-show_entries", entries, "-of", "json", "--", path],
        { encoding: "utf8" },
      ),
    );

  it.skipIf(!realFfmpeg || !findFfBinary("ffprobe"))(
    "keeps a whole copy when a track it leaves out runs longer than the picture",
    async () => {
      const shown = LONG_SECONDS - 3;
      const { proxyPath } = await realCopyOf("two-tracks.mp4", (path) =>
        execFileSync(realFfmpeg!, [
          ...["-v", "error", "-f", "lavfi", "-i", `color=c=blue:s=32x32:r=2:d=${shown}`],
          ...["-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:d=${shown}`],
          ...["-f", "lavfi", "-i", `sine=frequency=660:sample_rate=48000:d=${LONG_SECONDS}`],
          ...["-map", "0", "-map", "1", "-map", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p"],
          ...["-c:a", "aac", path],
        ]),
      );
      const streams = probeJson(proxyPath, "stream=codec_type,duration").streams;
      expect(streams.map((s: { codec_type: string }) => s.codec_type).sort()).toEqual([
        "audio",
        "video",
      ]);
      for (const stream of streams) expect(Number(stream.duration)).toBeCloseTo(shown, 0);
    },
    60_000,
  );

  const CLAPS = [2, 14.5, 15.2, 29.9, 30.4, 44.6, 47];
  const FPS = 30;
  const SILENCE_ARGS = ["-af", "silencedetect=n=-30dB:d=0.1", "-f", "null", "-"];
  const soundMinusFlashPerClap = (path: string, claps: number[]): number[] => {
    let at = 0;
    let lit = false;
    const flashes: number[] = [];
    const { stdout, stderr } = spawnSync(
      realFfmpeg!,
      [...["-i", path, "-vf", "signalstats,metadata=print:file=-"], ...SILENCE_ARGS],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    for (const line of stdout.split(/\r?\n/)) {
      const time = /pts_time:([\d.]+)/.exec(line);
      if (time) at = Number(time[1]);
      const luma = /YAVG=([\d.]+)/.exec(line);
      if (!luma) continue;
      if (Number(luma[1]) > 100 && !lit) flashes.push(at);
      lit = Number(luma[1]) > 100;
    }
    const quiet = [...stderr.matchAll(/silence_(start|end): ([\d.]+)/g)];
    const sounds = quiet.flatMap((match, index) =>
      match[1] === "end" && quiet[index + 1]?.[1] === "start" ? [Number(match[2])] : [],
    );
    expect(flashes).toHaveLength(claps.length);
    expect(sounds).toHaveLength(claps.length);
    return flashes.map((flash, index) => sounds[index]! - flash);
  };

  it.skipIf(!realFfmpeg || !findFfBinary("ffprobe")).each([
    ["picture starting late", 0.4, 0, String(FPS), LONG_SECONDS, CLAPS],
    ["sound starting late", 0, 0.4, String(FPS), LONG_SECONDS, CLAPS],
    ["at 29.97 frames a second over two minutes", 0, 0, "30000/1001", 120, [2, 61.3, 118]],
  ])(
    "keeps every clap within a frame of the source across the seams, %s",
    async (_case, pictureDelay, soundDelay, rate, seconds, claps) => {
      const during = (length: number) =>
        claps.map((clap) => `between(t,${clap},${clap + length})`).join("+");
      const { sourcePath, proxyPath } = await realCopyOf("claps.mp4", (path) =>
        execFileSync(realFfmpeg!, [
          ...["-v", "error", "-itsoffset", String(pictureDelay), "-f", "lavfi", "-i"],
          `color=black:s=32x32:r=${rate}:d=${seconds},drawbox=c=white:t=fill:enable='${during(2 / FPS)}'`,
          ...["-itsoffset", String(soundDelay), "-f", "lavfi", "-i"],
          `aevalsrc='(${during(0.03)})*sin(2*PI*1000*t)':s=48000:d=${seconds}`,
          ...["-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-pix_fmt", "yuv420p"],
          ...["-c:a", "aac", path],
        ]),
      );
      const source = soundMinusFlashPerClap(sourcePath, claps);
      soundMinusFlashPerClap(proxyPath, claps).forEach((offset, index) =>
        expect(Math.abs(offset - source[index]!)).toBeLessThanOrEqual(1 / FPS),
      );
    },
    120_000,
  );
});
