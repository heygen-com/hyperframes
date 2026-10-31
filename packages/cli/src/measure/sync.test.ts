import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findFFmpeg, findFFprobe } from "../browser/ffmpeg.js";
import { probeVideo } from "./media.js";
import { syncPass } from "./person.js";
import { avSync } from "./sync.js";

const ffmpeg = findFFmpeg();
const dir = mkdtempSync(join(tmpdir(), "hf-sync-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Uneven bursts so only one lag lines them up.
const BURSTS = [
  [0.3, 0.5],
  [0.9, 1.0],
  [1.4, 1.7],
  [2.1, 2.2],
  [2.5, 2.8],
];
const during = (shift: number) =>
  BURSTS.map(([a, b]) => `between(t,${a! + shift},${b! + shift})`).join("+");

const MOUTH: [number, number, number, number] = [24, 40, 48, 16];

function inStep(): string {
  const out = join(dir, "in-step.mp4");
  execFileSync(ffmpeg!, [
    ...["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x404040:s=96x96:r=30:d=3"],
    ...["-f", "lavfi", "-i", "sine=f=220:d=3"],
    "-filter_complex",
    `[0]drawbox=x=24:y=40:w=48:h=16:color=white:t=fill:enable='${during(0)}'[v];` +
      `[1]volume='if(${during(0)},1,0)':eval=frame[a]`,
    ...["-map", "[v]", "-map", "[a]", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-qp", "0", out],
  ]);
  return out;
}

/** The same streams with one of them stamped 0.2 s later, as a real muxer leaves it. */
function shifted(source: string, late: "video" | "audio"): string {
  const out = join(dir, `${late}-late.mp4`);
  const [first, second] =
    late === "video" ? [["-itsoffset", "0.2"], []] : [[], ["-itsoffset", "0.2"]];
  execFileSync(ffmpeg!, [
    ...["-v", "error", "-y", ...first, "-i", source, ...second, "-i", source],
    ...["-map", "0:v", "-map", "1:a", "-c", "copy", out],
  ]);
  return out;
}

describe.skipIf(!ffmpeg || !findFFprobe())("avSync", () => {
  it("reads the sound on its own timestamps, not from its first sample", () => {
    const aligned = inStep();
    expect(Math.abs(avSync(probeVideo(aligned), MOUTH, 0, 3).best_lag_ms!)).toBeLessThan(20);
    expect(Math.abs(avSync(probeVideo(aligned), MOUTH, 0.2, 2.9).best_lag_ms!)).toBeLessThan(20);
    const quiet = avSync(probeVideo(shifted(aligned, "audio")), MOUTH, 0, 3);
    expect(quiet.best_lag_ms).toBeGreaterThan(-230);
    expect(quiet.best_lag_ms).toBeLessThan(-170);
    expect(syncPass(quiet)).toBe(false);
    const inside = avSync(probeVideo(shifted(aligned, "audio")), MOUTH, 0.2, 2.9);
    expect(inside.best_lag_ms).toBeLessThan(-170);
    const late = avSync(probeVideo(shifted(aligned, "video")), MOUTH, 0, 3);
    expect(late.best_lag_ms).toBeGreaterThan(170);
    expect(late.best_lag_ms).toBeLessThan(230);
  });

  it("finds a picture two frames late", () => {
    const out = join(dir, "late.mp4");
    execFileSync(ffmpeg!, [
      ...["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x404040:s=96x96:r=30:d=3"],
      ...["-f", "lavfi", "-i", "sine=f=220:d=3"],
      "-filter_complex",
      `[0]drawbox=x=24:y=40:w=48:h=16:color=white:t=fill:enable='${during(2 / 30)}'[v];` +
        `[1]volume='if(${during(0)},1,0)':eval=frame[a]`,
      ...["-map", "[v]", "-map", "[a]", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-qp", "0", out],
    ]);
    const r = avSync(probeVideo(out), [24, 40, 48, 16], 0, 3);
    expect(r.best_lag_frames).toBeGreaterThan(1.5);
    expect(r.best_lag_frames).toBeLessThan(2.5);
    expect(r.best_lag_ms).toBeGreaterThan(0);
    expect(r.confidence).not.toBe("none");
  });
});
