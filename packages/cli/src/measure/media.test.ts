import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findFFmpeg, findFFprobe } from "../browser/ffmpeg.js";
import { readFrames } from "./media.js";

const ffmpeg = findFFmpeg();
const dir = mkdtempSync(join(tmpdir(), "hf-media-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!ffmpeg || !findFFprobe())("readFrames", () => {
  it("reads an odd-sized region of 4:2:0 video from 0 s as the same pixels the whole frame shows", () => {
    const clip = join(dir, "t.mp4");
    execFileSync(ffmpeg!, [
      ...["-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:d=1:r=10"],
      ...["-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "0", clip],
    ]);
    const roi: [number, number, number, number] = [31, 21, 101, 75];
    const part = readFrames(clip, { start: 0, seconds: 1, roi, gray: true });
    const whole = readFrames(clip, { start: 0, seconds: 1, gray: true });
    expect([part.w, part.h, part.frames.length]).toEqual([101, 75, 10]);
    whole.frames.forEach((f, k) => {
      for (const y of [0, 37, 74]) {
        const at = (roi[1] + y) * 320 + roi[0];
        expect(part.frames[k]!.subarray(y * 101, (y + 1) * 101)).toEqual(f.subarray(at, at + 101));
      }
    });
  });
});
