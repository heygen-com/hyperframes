import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { afterEach, describe, expect, it, vi } from "vitest";

const realFfmpeg = findFfBinary("ffmpeg");
// Mirrors PROXY_CHUNK_SECONDS in proxyTranscoder.ts: three pieces, the last taking the remainder.
const PIECE_SECONDS = 15;
const LONG_SECONDS = 3 * PIECE_SECONDS + 5;

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

describe("resolveProxy joining a long source's pieces with real ffmpeg", () => {
  const clip = (path: string, seconds: number) =>
    execFileSync(realFfmpeg!, [
      ...["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=blue:s=32x32:r=30:d=${seconds}`],
      ...["-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:d=${seconds}`],
      ...["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path],
    ]);
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
    "joins the pieces of a source with sound into one copy that keeps its sound",
    async () => {
      const { proxyPath } = await realCopyOf("talk.mp4", (path) =>
        execFileSync(realFfmpeg!, [
          ...["-v", "error", "-f", "lavfi", "-i", `color=c=blue:s=32x32:r=2:d=${LONG_SECONDS}`],
          ...["-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:d=${LONG_SECONDS}`],
          ...["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path],
        ]),
      );
      const probed = probeJson(proxyPath, "stream=codec_type:format=duration");
      expect(probed.streams.map((s: { codec_type: string }) => s.codec_type).sort()).toEqual([
        "audio",
        "video",
      ]);
      expect(Number(probed.format.duration)).toBeCloseTo(LONG_SECONDS, 0);
    },
    60_000,
  );

  it.skipIf(!realFfmpeg || !findFfBinary("ffprobe")).each([
    ["ends early", (piece: string) => clip(piece, 5)],
    ["ends 0.8 s early", (piece: string) => clip(piece, 19.2)],
    ["was cut off", (piece: string) => writeFileSync(piece, readFileSync(piece).subarray(0, 2000))],
  ])(
    "makes a piece left from a stopped copy again when it %s",
    async (_name, spoil) => {
      vi.resetModules();
      vi.doUnmock("./mediaMetadata.js");
      vi.doMock("@hyperframes/core/preview-proof", () => ({ previewToken: () => "a".repeat(64) }));
      const { resolveProxy } = await import("./proxyTranscoder.js");
      const projectDir = realpathSync(tmpProject());
      const sourcePath = join(projectDir, "talk.mp4");
      clip(sourcePath, LONG_SECONDS);
      const stop = new AbortController();
      const stopped = resolveProxy(projectDir, sourcePath, "h264", undefined, {
        signal: stop.signal,
        onProgress: ({ doneSeconds }) => doneSeconds >= LONG_SECONDS && stop.abort(),
      }).catch((error: unknown) => error);
      expect(await stopped).toBe(stop.signal.reason);
      const cache = join(projectDir, ".transcode-cache");
      const last = readdirSync(cache).find((name) => /^\.part-.*-2\.mp4$/.test(name))!;
      spoil(join(cache, last));

      const heard: number[] = [];
      const proxyPath = await resolveProxy(projectDir, sourcePath, "h264", undefined, {
        onProgress: ({ doneSeconds }) => heard.push(doneSeconds),
      });
      expect(heard[0]).toBeGreaterThanOrEqual(2 * PIECE_SECONDS);
      const picture = probeJson(proxyPath, "stream=codec_type,duration").streams.find(
        (s: { codec_type: string }) => s.codec_type === "video",
      );
      expect(Number(picture.duration)).toBeCloseTo(LONG_SECONDS, 0);
    },
    60_000,
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
  const soundMinusFlashPerClap = (path: string, claps: number[]): number[] => {
    let at = 0;
    let lit = false;
    const flashes: number[] = [];
    const frames = execFileSync(
      realFfmpeg!,
      ["-v", "error", "-i", path, "-vf", "signalstats,metadata=print:file=-", "-f", "null", "-"],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    for (const line of frames.split(/\r?\n/)) {
      const time = /pts_time:([\d.]+)/.exec(line);
      if (time) at = Number(time[1]);
      const luma = /YAVG=([\d.]+)/.exec(line);
      if (!luma) continue;
      if (Number(luma[1]) > 100 && !lit) flashes.push(at);
      lit = Number(luma[1]) > 100;
    }
    const { stderr } = spawnSync(
      realFfmpeg!,
      ["-i", path, "-map", "0:a", "-af", "silencedetect=n=-30dB:d=0.1", "-f", "null", "-"],
      { encoding: "utf8" },
    );
    const quiet = [...stderr.matchAll(/silence_(start|end): ([\d.]+)/g)];
    const sounds = quiet.flatMap((match, index) =>
      match[1] === "end" && quiet[index + 1]?.[1] === "start" ? [Number(match[2])] : [],
    );
    expect(flashes).toHaveLength(claps.length);
    expect(sounds).toHaveLength(claps.length);
    return flashes.map((flash, index) => sounds[index]! - flash);
  };

  it.skipIf(!realFfmpeg || !findFfBinary("ffprobe")).each([
    ["picture and sound together", 0, 0, String(FPS), LONG_SECONDS, CLAPS],
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
