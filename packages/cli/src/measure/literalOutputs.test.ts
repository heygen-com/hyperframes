import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { ffmpegToFile } from "./media.js";

const cliEntry = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.ts");
const root = mkdtempSync(join(tmpdir(), "hf-literal-outputs-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const PATTERN = /write it as a pattern of other files/;

function measure(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", ["run", cliEntry, "measure", ...args, "--json"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
      env: { PATH: process.env.PATH, HOME: root, USERPROFILE: root, CI: "1" },
    });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.on("error", reject);
    child.on("close", () => resolve(out));
  });
}

describe.skipIf(!hasFfmpeg)("measure outputs whose name ffmpeg would read as a pattern", () => {
  const clip = join(root, "clip.mp4");
  spawnSync("ffmpeg", [
    ...["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=64x64:r=10:d=1"],
    ...["-pix_fmt", "yuv420p", clip],
  ]);

  it("the shared writer refuses a pattern-like output before ffmpeg writes anything", () => {
    const folder = join(root, "writer");
    mkdirSync(folder);
    const still = ["-y", "-f", "lavfi", "-i", "color=red:s=16x16", "-frames:v", "1"];
    expect(() => ffmpegToFile(still, join(folder, "still%d.png"))).toThrow(PATTERN);
    expect(readdirSync(folder)).toEqual([]);
  });

  it("measure extract refuses an --out that reads as a pattern", async () => {
    const out = join(root, "extract", "still%03d.png");
    expect(await measure(["extract", clip, "--at", "0", "--out", out])).toMatch(PATTERN);
  }, 60_000);

  it("measure frames refuses an --out folder that reads as a pattern", async () => {
    const out = join(root, "frames%%");
    expect(await measure(["frames", clip, "--at", "0", "--out", out])).toMatch(PATTERN);
  }, 60_000);
});
