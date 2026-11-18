import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { MEDIA_INPUT_ARGS, mediaInputArgs } from "./mediaExtensions.js";

const ffmpeg = findFfBinary("ffmpeg");
const ffprobe = findFfBinary("ffprobe");
const dir = mkdtempSync(join(tmpdir(), "hf-media-input-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const probe = (file: string) =>
  spawnSync(
    ffprobe!,
    [
      "-v",
      "error",
      "-show_entries",
      "format=format_name",
      "-of",
      "csv=p=0",
      ...MEDIA_INPUT_ARGS,
      "--",
      file,
    ],
    { encoding: "utf8" },
  );

describe.skipIf(!ffmpeg || !ffprobe)("MEDIA_INPUT_ARGS with a real ffprobe", () => {
  const video = ["-f", "lavfi", "-i", "testsrc2=s=64x36:r=10:d=1"];
  const audio = ["-f", "lavfi", "-i", "sine=d=1"];
  const make = (name: string, args: string[]) => {
    execFileSync(ffmpeg!, ["-v", "error", "-y", ...args, join(dir, name)]);
    return join(dir, name);
  };

  it.each([
    ["clip.mp4", [...video, "-pix_fmt", "yuv420p"]],
    ["frag.mp4", [...video, "-pix_fmt", "yuv420p", "-movflags", "frag_keyframe+empty_moov"]],
    ["clip.mov", [...video, "-c:v", "prores_ks"]],
    ["clip.webm", [...video, "-c:v", "libvpx"]],
    ["clip.ts", [...video, "-pix_fmt", "yuv420p", "-f", "mpegts"]],
    ["song.wav", audio],
    ["song.mp3", audio],
    ["still.png", [...video, "-frames:v", "1"]],
    ["still.jpg", [...video, "-frames:v", "1"]],
    ["loop.gif", [...video, "-frames:v", "3"]],
  ])("still reads %s", (name, args) => {
    const result = probe(make(name, args as string[]));
    expect(result.status, result.stderr).toBe(0);
  });

  it.each([
    ["a concat script", "list.mp4", "ffconcat version 1.0\nfile clip.mp4\n"],
    [
      "an HLS playlist",
      "list.m3u8",
      "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nclip.ts\n#EXT-X-ENDLIST\n",
    ],
  ])("never opens %s, which names other files", (_kind, name, text) => {
    writeFileSync(join(dir, name), text);
    const result = probe(join(dir, name));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/not on whitelist/);
  });
});

describe("mediaInputArgs", () => {
  it("refuses a path ffmpeg would read as a pattern of other files", () => {
    expect(() => mediaInputArgs(join(dir, "decoy%d.png"))).toThrow(/pattern of other files/);
    expect(mediaInputArgs(join(dir, "clip 100% done.mp4"))).toEqual(MEDIA_INPUT_ARGS);
  });
});
