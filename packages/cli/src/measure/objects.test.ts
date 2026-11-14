import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findFFmpeg, findFFprobe } from "../browser/ffmpeg.js";
import { probeVideo } from "./media.js";
import { objects } from "./objects.js";

const ffmpeg = findFFmpeg();
const dir = mkdtempSync(join(tmpdir(), "hf-objects-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** White 16 px squares centred on `points` over black. */
function squares(name: string, points: [number, number][]): string {
  const out = join(dir, name);
  const boxes = points.map(
    ([x, y]) =>
      `drawbox=x=${Math.round(x - 8)}:y=${Math.round(y - 8)}:w=16:h=16:color=white:t=fill`,
  );
  execFileSync(ffmpeg!, [
    ...["-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "color=black:s=320x180:d=0.5:r=10"],
    ...["-vf", boxes.join(","), "-pix_fmt", "yuv444p", "-c:v", "libx264", "-crf", "0", out],
  ]);
  return out;
}

const measure = (video: string) => objects(video, probeVideo(video), 0.2, [0, 0, 320, 180]);

describe.skipIf(!ffmpeg || !findFFprobe())("objects", () => {
  it("reads six squares on a circle as an evenly spaced ring", () => {
    const ring = Array.from({ length: 6 }, (_, i): [number, number] => [
      160 + 60 * Math.cos((i * Math.PI) / 3),
      90 + 60 * Math.sin((i * Math.PI) / 3),
    ]);
    const r = measure(squares("ring.mp4", ring));
    expect(r.count).toBe(6);
    expect(r.arrangement).toMatchObject({
      kind: "ring",
      count: 6,
      evenly_spaced: true,
      touching: false,
    });
  });

  it("reads a 3x2 layout as a grid", () => {
    const grid: [number, number][] = [60, 160, 260].flatMap((x) =>
      [50, 130].map((y): [number, number] => [x, y]),
    );
    const r = measure(squares("grid.mp4", grid));
    expect(r.count).toBe(6);
    expect(r.arrangement).toMatchObject({ kind: "grid", rows: 2, cols: 3 });
  });
});
