import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findFFmpeg, findFFprobe } from "../browser/ffmpeg.js";
import { scan, summary } from "./ink.js";

const ffmpeg = findFFmpeg();
const dir = mkdtempSync(join(tmpdir(), "hf-ink-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!ffmpeg || !findFFprobe())("ink scan", () => {
  it("finds when a light box is on screen and where", () => {
    const clip = join(dir, "t.mp4");
    execFileSync(ffmpeg!, [
      ...["-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "color=black:s=320x180:d=2:r=10"],
      ...["-vf", "drawbox=x=100:y=50:w=60:h=20:color=white:t=fill:enable='between(t,0.5,1.45)'"],
      ...["-pix_fmt", "yuv444p", "-c:v", "libx264", "-crf", "0", clip],
    ]);
    const s = summary(scan(clip, 0, 2, [0, 0, 320, 180]));
    expect(s.first_visible).toBe(0.5);
    expect(s.last_visible).toBe(1.4);
    const [row] = scan(clip, 1, 0.15, [0, 0, 320, 180], { fps: 0 });
    row!.box!.forEach((v, i) => expect(Math.abs(v - [100, 50, 60, 20][i]!)).toBeLessThanOrEqual(1));
  });
});
