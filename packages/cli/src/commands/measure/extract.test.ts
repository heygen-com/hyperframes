import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { findFFmpeg, findFFprobe } from "../../browser/ffmpeg.js";
import { probeVideo, readFrames, type Roi } from "../../measure/media.js";
import extract, { cutClip } from "./extract.js";

const ffmpeg = findFFmpeg();
const dir = mkdtempSync(join(tmpdir(), "hf-extract-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const mad = (a: Uint8Array, b: Uint8Array) =>
  a.reduce((s, v, i) => s + Math.abs(v - b[i]!), 0) / a.length;

describe.skipIf(!ffmpeg || !findFFprobe())("measure extract", () => {
  it("cuts a clip from an odd offset at that offset", () => {
    const src = join(dir, "src.mp4");
    execFileSync(ffmpeg!, [
      ...["-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:d=1:r=10"],
      ...["-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "0", src],
    ]);
    const out = join(dir, "cut.mp4");
    const asked: Roi = [31, 21, 100, 74];
    const { roi } = cutClip(probeVideo(src), 0, 1, asked, out, { crf: 0 });
    expect(roi).toEqual(asked);
    const [cut] = readFrames(out, { start: 0, seconds: 0.1, gray: true }).frames;
    const at = (r: Roi) =>
      readFrames(src, { start: 0, seconds: 0.1, roi: r, gray: true }).frames[0]!;
    expect(mad(cut!, at(asked))).toBeLessThan(0.5);
    expect(mad(cut!, at([30, 20, 100, 74]))).toBeGreaterThan(mad(cut!, at(asked)) + 1);
  });

  it("refuses a WebM clip before writing anything", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(
        extract.run!({
          args: {
            video: join(dir, "src.mp4"),
            from: "0",
            to: "1",
            out: join(dir, "cut.webm"),
            json: false,
          },
          rawArgs: [],
          cmd: extract,
        } as never),
      ).rejects.toThrow();
      const answer = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
      expect(answer.ok).toBe(false);
      expect(answer.fix).toMatch(/\.mp4/);
    } finally {
      log.mockRestore();
    }
  });
});
