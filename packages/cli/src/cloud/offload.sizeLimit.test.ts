import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { sizeLimitArgs } from "./offload.js";

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
  it("fits a noise clip that crf alone leaves over the cap", () => {
    const source = join(dir, "noise.mp4");
    execFileSync(ffmpeg!, [
      ...["-v", "error", "-y", "-f", "lavfi"],
      ...["-i", "nullsrc=s=640x360:r=30,geq=random(1)*255:128:128", "-t", "20"],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-crf", "10", "-pix_fmt", "yuv420p", source],
    ]);
    const encode = (out: string, limit: string[]) =>
      execFileSync(ffmpeg!, [
        ...["-v", "error", "-y", "-i", source],
        ...["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p"],
        ...limit,
        out,
      ]);
    const cap = 4 * MiB;
    const free = join(dir, "free.mp4");
    const limited = join(dir, "limited.mp4");
    encode(free, []);
    encode(limited, sizeLimitArgs({ maxBytes: cap, seconds: 20, audioBitsPerSecond: 0 }));
    expect(statSync(free).size).toBeGreaterThan(cap);
    expect(statSync(limited).size).toBeLessThanOrEqual(cap);
  });
});
