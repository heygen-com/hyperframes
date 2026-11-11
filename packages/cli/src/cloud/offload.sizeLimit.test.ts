import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { limitFor, sizeLimitArgs } from "./offload.js";

const ffmpeg = findFfBinary("ffmpeg");
const dir = mkdtempSync(join(tmpdir(), "hf-offload-limit-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const MiB = 1024 * 1024;

describe("sizeLimitArgs", () => {
  it("limits the video rate to 85% of the cap over the clip's length, less the audio", () => {
    // 200 MiB x 8 x 0.85 / 100 s = 14,260,634 bit/s; minus 320 kbit/s of audio.
    expect(
      sizeLimitArgs({ maxBytes: 200 * MiB, seconds: 100, audioBitsPerSecond: 320_000 }),
    ).toEqual(["-maxrate", "13940k", "-bufsize", "13940k"]);
  });

  it("sets no limit when the audio alone fills the budget", () => {
    expect(sizeLimitArgs({ maxBytes: MiB, seconds: 3600, audioBitsPerSecond: 320_000 })).toEqual(
      [],
    );
  });
});

describe.skipIf(!ffmpeg)("a re-encode with the limit", () => {
  const clip = join(dir, "clip.mp4");
  const noise = (seconds: number) =>
    execFileSync(ffmpeg!, [
      ...["-v", "error", "-y", "-f", "lavfi"],
      ...["-i", "nullsrc=s=320x180:r=15,geq=random(1)*255:128:128", "-t", String(seconds)],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-crf", "10", "-pix_fmt", "yuv420p", clip],
    ]);

  it("fits a noise clip that crf alone leaves over the cap", { timeout: 60_000 }, () => {
    noise(8);
    const encode = (out: string, limit: string[]) =>
      execFileSync(ffmpeg!, [
        ...["-v", "error", "-y", "-i", clip],
        ...["-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", "-pix_fmt", "yuv420p"],
        ...limit,
        out,
      ]);
    const cap = 1 * MiB;
    const free = join(dir, "free.mp4");
    const limited = join(dir, "limited.mp4");
    encode(free, []);
    encode(limited, sizeLimitArgs({ maxBytes: cap, seconds: 8, audioBitsPerSecond: 0 }));
    expect(statSync(free).size).toBeGreaterThan(cap);
    expect(statSync(limited).size).toBeLessThanOrEqual(cap);
  });

  it("limits any video by its length, a played cut by the cut's length", async () => {
    noise(4);
    const whole = await limitFor(clip, "video", undefined, MiB);
    const cut = await limitFor(clip, "video", [{ start: 0, end: 2 }], MiB);
    expect(whole[0]).toBe("-maxrate");
    expect(Number.parseInt(cut[1]!, 10)).toBeGreaterThan(Number.parseInt(whole[1]!, 10));
  });

  it("leaves audio and images to their own presets", async () => {
    noise(1);
    expect(await limitFor(clip, "audio", undefined, MiB)).toEqual([]);
    expect(await limitFor(clip, "image", undefined, MiB)).toEqual([]);
  });

  it("adds -b:v for the VP9 alpha preset, whose constant-quality mode ignores -maxrate", async () => {
    noise(4);
    const args = await limitFor(clip, "alphaVideo", undefined, MiB);
    expect(args.slice(-2)).toEqual(["-b:v", args[1]]);
  });
});
