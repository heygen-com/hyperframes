import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findFFmpeg, findFFprobe } from "../browser/ffmpeg.js";
import { compareCurves, curves } from "./curve.js";

const ffmpeg = findFFmpeg();
const dir = mkdtempSync(join(tmpdir(), "hf-curve-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A white box sliding 0.5 s with back.out(1.7) from x=20 to x=220, starting at 0.3 s + `shift`. */
function slide(name: string, shift: number): string {
  const q = `min(max((t-0.3)/0.5,0),1)-1`;
  const x = `20+200*(1+2.7*pow(${q},3)+1.7*pow(${q},2))`.replaceAll("t", `(t-${shift})`);
  const out = join(dir, name);
  execFileSync(ffmpeg!, [
    ...["-nostdin", "-v", "error", "-y"],
    ...["-f", "lavfi", "-i", "color=black:s=320x120:d=1.2:r=30"],
    ...["-f", "lavfi", "-i", "color=white:s=40x40:d=1.2:r=30"],
    ...["-filter_complex", `[0][1]overlay=x='${x}':y=40`],
    ...["-pix_fmt", "yuv444p", "-c:v", "libx264", "-crf", "0", out],
  ]);
  return out;
}

describe.skipIf(!ffmpeg || !findFFprobe())("curves", () => {
  it("reads a back.out slide's ease, length and overshoot, and pairs it with a later copy", () => {
    const a = curves(slide("a.mp4", 0), 0, 1.2, [0, 0, 320, 120]);
    const b = curves(slide("b.mp4", 0.1), 0, 1.2, [0, 0, 320, 120]);
    expect(a.moves).toHaveLength(1);
    const x = a.moves[0];
    if (!x || x.pulse) throw new Error("expected one fitted move");
    expect(x.prop).toBe("x");
    expect(x.ease).toMatch(/^back\.out\(1\.[5-9]\)/);
    expect(Math.abs(x.duration_s - 0.5)).toBeLessThanOrEqual(0.07);
    expect(Math.abs(x.overshoot_pct - 10)).toBeLessThanOrEqual(3);
    const c = compareCurves(a, b).find((m) => m.prop === "x")!;
    expect(Math.abs(c.start_offset_s! - 0.1)).toBeLessThanOrEqual(0.04);
    expect(c.curve_rmse!).toBeLessThan(0.05);
  });
});
