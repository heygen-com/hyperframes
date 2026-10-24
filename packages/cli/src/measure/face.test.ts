import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findFFmpeg, findFFprobe } from "../browser/ffmpeg.js";
import { faceBoxes } from "./face.js";
import { probeVideo } from "./media.js";

const ffmpeg = findFFmpeg();
const dir = mkdtempSync(join(tmpdir(), "hf-face-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!ffmpeg || !findFFprobe())("faceBoxes", () => {
  it("samples as many frames as asked when the sound outlasts the picture", async () => {
    const out = join(dir, "long-sound.mp4");
    execFileSync(ffmpeg!, [
      ...["-v", "error", "-y", "-f", "lavfi", "-i", "color=gray:s=96x96:r=30:d=1"],
      ...["-f", "lavfi", "-i", "sine=f=220:d=1.3"],
      ...["-pix_fmt", "yuv420p", "-c:v", "libx264", "-c:a", "aac", out],
    ]);
    const info = probeVideo(out);
    const samples = await faceBoxes(info, 0, info.duration, 5);
    expect(samples.map((s) => s.frame)).toEqual([0, 7, 15, 22, 29]);
  });
});
