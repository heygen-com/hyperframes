import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findFFmpeg, findFFprobe } from "../browser/ffmpeg.js";
import { probeVideo } from "./media.js";
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

/** A 3 s clip whose white box flashes two frames after each burst of sound. */
function lateClip() {
  const out = join(dir, "late.mp4");
  execFileSync(ffmpeg!, [
    ...["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x404040:s=96x96:r=30:d=3"],
    ...["-f", "lavfi", "-i", "sine=f=220:d=3"],
    "-filter_complex",
    `[0]drawbox=x=24:y=40:w=48:h=16:color=white:t=fill:enable='${during(2 / 30)}'[v];` +
      `[1]volume='if(${during(0)},1,0)':eval=frame[a]`,
    ...["-map", "[v]", "-map", "[a]", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-qp", "0", out],
  ]);
  return out;
}

describe.skipIf(!ffmpeg || !findFFprobe())("avSync", () => {
  it("finds a picture two frames late", () => {
    const out = lateClip();
    const r = avSync(probeVideo(out), [24, 40, 48, 16], 0, 3);
    expect(r.best_lag_frames).toBeGreaterThan(1.5);
    expect(r.best_lag_frames).toBeLessThan(2.5);
    expect(r.best_lag_ms).toBeGreaterThan(0);
    expect(r.confidence).not.toBe("none");
  });

  it("reads a window that starts between two frames as the one starting on the next frame", () => {
    const info = probeVideo(lateClip());
    expect(avSync(info, [24, 40, 48, 16], 0.24, 3)).toEqual(
      avSync(info, [24, 40, 48, 16], 8 / 30, 3),
    );
  });
});
