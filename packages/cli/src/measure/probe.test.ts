import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { probeReport } from "../commands/measure/probe.js";

const root = mkdtempSync(join(tmpdir(), "hf-probe-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

describe.skipIf(!hasFfmpeg)("measure probe --normalize", () => {
  const clip = join(root, "clip.mp4");
  spawnSync("ffmpeg", [
    ...["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=64x64:r=10:d=1"],
    ...["-pix_fmt", "yuv420p", clip],
  ]);

  it("writes the copy over a link at the output name, never through it", () => {
    const project = join(root, "project");
    mkdirSync(project);
    const elsewhere = join(root, "elsewhere.txt");
    writeFileSync(elsewhere, "keep me");
    const out = join(project, "original.mp4");
    symlinkSync(elsewhere, out);

    const report = probeReport(clip, out) as { normalized?: string };

    expect(readFileSync(elsewhere, "utf8")).toBe("keep me");
    expect(report.normalized).toBe(out);
    expect(lstatSync(out).isFile()).toBe(true);
    expect(lstatSync(out).size).toBeGreaterThan(0);
  }, 60_000);
});
