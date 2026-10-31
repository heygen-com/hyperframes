import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { basename, join } from "node:path";
import { afterAll, beforeAll } from "vitest";
import { findFFmpeg, findFFprobe } from "../browser/ffmpeg.js";
import { diffVideos, type DiffOptions } from "./diff.js";
import { loadOpenCv, OPENCV_DIR } from "./opencv.js";

export const ffmpeg = findFFmpeg();
export const noTools = !ffmpeg || !findFFprobe();

/** testsrc2, 3 s at 30 fps: the original most of diff's tests compare against. */
export const REF_ARGS = ["-f", "lavfi", "-i", "testsrc2=d=3:r=30:s=320x180"];

/** A temp folder for one test file's clips, removed after its tests, and a maker of lossless synthetic clips in it,
 *  so SSIM differences come from the picture, not the encoder. */
export function clipFolder(prefix: string): {
  dir: string;
  clip: (name: string, args: string[]) => string;
} {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const clip = (name: string, args: string[]): string => {
    const out = join(dir, name);
    execFileSync(ffmpeg!, [
      ...["-hide_banner", "-loglevel", "error", "-y", ...args],
      ...["-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "0", out],
    ]);
    return out;
  };
  return { dir, clip };
}

/** diffVideos for a test that reads verdicts only: no worst-moment pictures, each of which costs seven ffmpeg runs. */
export const diffVerdicts = (options: DiffOptions) => diffVideos({ worst: 0, ...options });

/** opencv.js loaded before a block's tests, so none pays for its download inside the per-test limit. The files come
 *  from this machine's cache, else a temp copy kept between runs (each has its own home), else the network. */
export function loadOpenCvFirst(): void {
  beforeAll(async () => {
    const shared = join(tmpdir(), `hf-test-opencv-${basename(OPENCV_DIR)}`);
    const machine = join(
      userInfo().homedir,
      ".cache",
      "hyperframes",
      "opencv",
      basename(OPENCV_DIR),
    );
    for (const from of [machine, shared])
      if (!existsSync(join(OPENCV_DIR, "opencv.js")) && existsSync(join(from, "opencv.js")))
        cpSync(from, OPENCV_DIR, { recursive: true });
    await loadOpenCv();
    if (existsSync(join(shared, "opencv.js"))) return;
    const staged = `${shared}-${process.pid}`;
    cpSync(OPENCV_DIR, staged, { recursive: true });
    try {
      renameSync(staged, shared);
    } catch {
      rmSync(staged, { recursive: true, force: true });
    }
  }, 90_000);
}
