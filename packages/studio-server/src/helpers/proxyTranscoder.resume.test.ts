import { execFileSync } from "node:child_process";
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
  const dir = mkdtempSync(join(tmpdir(), "hf-proxy-resume-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.resetModules();
});

const probeJson = (path: string, entries: string) =>
  JSON.parse(
    execFileSync(
      findFfBinary("ffprobe")!,
      ["-v", "error", "-show_entries", entries, "-of", "json", "--", path],
      { encoding: "utf8" },
    ),
  );

describe("resolveProxy resuming a stopped copy of a long source", () => {
  const clip = (path: string, seconds: number) =>
    execFileSync(realFfmpeg!, [
      ...["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=blue:s=32x32:r=30:d=${seconds}`],
      ...["-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:d=${seconds}`],
      ...["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path],
    ]);
  it.skipIf(!realFfmpeg || !findFfBinary("ffprobe")).each([
    ["ends 0.8 s early", (piece: string) => clip(piece, 19.2)],
    [
      "was cut off half way, its header still claiming the whole length",
      (piece: string) => {
        const bytes = readFileSync(piece);
        writeFileSync(piece, bytes.subarray(0, bytes.length / 2));
      },
    ],
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
});
