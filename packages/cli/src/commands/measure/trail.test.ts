import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { findFFmpeg, findFFprobe } from "../../browser/ffmpeg.js";
import trail from "./trail.js";

const ffmpeg = findFFmpeg();
const dir = mkdtempSync(join(tmpdir(), "hf-trail-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!ffmpeg || !findFFprobe())("measure trail", () => {
  it("draws a 30 s, 60 fps window, too large to hold in colour", { timeout: 120_000 }, async () => {
    // 1,800 frames of 640x360 RGB is 1.24 GB, over the decode's 1 GiB limit.
    const clip = join(dir, "long.mp4");
    execFileSync(ffmpeg!, [
      ...["-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=640x360:r=60:d=30"],
      ...["-vf", "drawbox=x='mod(t*40,600)':y=150:w=40:h=40:color=red:t=fill"],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", clip],
    ]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await trail.run!({
        args: { video: clip, from: "0", to: "30", out: join(dir, "out"), json: false },
        rawArgs: [],
        cmd: trail,
      } as never);
      const answer = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
      expect(answer.ok).toBe(true);
      expect(answer.ghosts).toBe(8);
      expect(answer.path.filter((p: { x: number | null }) => p.x !== null).length).toBe(8);
    } finally {
      log.mockRestore();
    }
  });
});
