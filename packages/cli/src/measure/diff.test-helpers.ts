import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { basename, dirname, join } from "node:path";
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

const machineOpenCv = join(
  userInfo().homedir,
  ".cache",
  "hyperframes",
  "opencv",
  basename(OPENCV_DIR),
);
const sharedOpenCv = () => join(tmpdir(), `hf-test-opencv-${basename(OPENCV_DIR)}`);

/** A cached opencv.js copied into this file's home, in private folders: opencv.ts refuses group-writable ones. */
export function seedOpenCvFromCache(): boolean {
  for (const from of [machineOpenCv, sharedOpenCv()])
    if (!existsSync(join(OPENCV_DIR, "opencv.js")) && existsSync(join(from, "opencv.js"))) {
      mkdirSync(dirname(OPENCV_DIR), { recursive: true, mode: 0o700 });
      cpSync(from, OPENCV_DIR, { recursive: true });
    }
  return existsSync(join(OPENCV_DIR, "opencv.js"));
}

/** opencv.js loaded before a block's tests, so none pays for its download inside the per-test limit. Without a cached
 *  copy it downloads, except on CI, where the opencv-test-cache action fills the machine's cache before the tests. */
export function loadOpenCvFirst(): void {
  beforeAll(async () => {
    if (!seedOpenCvFromCache() && process.env.CI)
      throw new Error(
        `opencv.js is not in ${machineOpenCv}: on CI the opencv-test-cache action puts it there`,
      );
    await loadOpenCv();
    const shared = sharedOpenCv();
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
