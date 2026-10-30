import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findFFmpeg, findFFprobe } from "../browser/ffmpeg.js";
import { rhythm } from "./rhythm.js";

const ffmpeg = findFFmpeg();
const dir = mkdtempSync(join(tmpdir(), "hf-rhythm-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const run = (args: string[]) => execFileSync(ffmpeg!, ["-nostdin", "-v", "error", "-y", ...args]);

describe.skipIf(!ffmpeg || !findFFprobe())("rhythm", () => {
  it("reads a held picture as a static camera and a centred zoom as a push in", () => {
    const still = join(dir, "still.png");
    run(["-f", "lavfi", "-i", "testsrc=s=320x180:d=1", "-frames:v", "1", still]);
    const held = join(dir, "held.mp4");
    run(["-loop", "1", "-i", still, "-t", "2", "-r", "30", "-pix_fmt", "yuv420p", held]);
    const zoom = join(dir, "zoom.mp4");
    run([
      ...["-i", still, "-vf"],
      "zoompan=z='1+0.003*on':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=60:s=320x180:fps=30",
      ...["-pix_fmt", "yuv420p", zoom],
    ]);
    expect(rhythm(held).shots.map((s) => s.camera)).toEqual(["static"]);
    const pushed = rhythm(zoom).shots;
    expect(pushed).toHaveLength(1);
    expect(pushed[0]!.camera).toBe("push in");
    expect(pushed[0]!.zoom).toBeGreaterThan(1.03);
  });
});
