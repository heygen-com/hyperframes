import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findFFmpeg, findFFprobe } from "../browser/ffmpeg.js";
import { continuity } from "./continuity.js";

const ffmpeg = findFFmpeg();
const dir = mkdtempSync(join(tmpdir(), "hf-continuity-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function clip(name: string, args: string[]): string {
  const out = join(dir, name);
  execFileSync(ffmpeg!, [
    ...["-v", "error", "-y", ...args],
    ...["-pix_fmt", "yuv420p", "-c:v", "libx264", "-qp", "0", out],
  ]);
  return out;
}

describe.skipIf(!ffmpeg || !findFFprobe())("continuity", () => {
  it("flags a frame the original does not have as a jump", () => {
    const original = clip("orig.mp4", ["-f", "lavfi", "-i", "testsrc2=d=2:r=30:s=160x90"]);
    const yours = clip("jump.mp4", [
      ...["-i", original, "-vf"],
      "drawbox=x=0:y=0:w=160:h=90:color=red:t=fill:enable='eq(n,30)'",
    ]);
    const r = continuity(original, yours, { outDir: dir });
    const jumps = r.events.filter((e) => e.kind === "jump");
    expect(jumps).toHaveLength(1);
    expect(jumps[0]!.peak_frame).toBeGreaterThanOrEqual(30);
    expect(jumps[0]!.peak_frame).toBeLessThanOrEqual(31);
    expect(existsSync(jumps[0]!.sheet)).toBe(true);
  });

  it("flags a shape drawn over a still background as structure", () => {
    const original = clip("still.mp4", ["-f", "lavfi", "-i", "color=c=0x305070:s=160x90:r=30:d=2"]);
    const yours = clip("box.mp4", [
      ...["-i", original, "-vf"],
      "drawbox=x=100:y=20:w=24:h=24:color=white:t=fill:enable='between(n,20,29)'",
    ]);
    const r = continuity(original, yours, { outDir: dir });
    const shapes = r.events.filter((e) => e.kind === "structure");
    expect(shapes.length).toBeGreaterThan(0);
    expect(shapes[0]!.peak_frame).toBeGreaterThanOrEqual(20);
    expect(shapes[0]!.peak_frame).toBeLessThanOrEqual(29);
    expect(shapes[0]!.at![0]).toBeGreaterThan(80);
  });
});
