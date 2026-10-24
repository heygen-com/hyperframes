import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { findFFmpeg, findFFprobe } from "../../browser/ffmpeg.js";
import frames from "./frames.js";

const ffmpeg = findFFmpeg();
const dir = mkdtempSync(join(tmpdir(), "hf-frames-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** The command's JSON answer for `args`. */
async function run(args: Record<string, unknown>) {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await frames.run!({
      args: { json: false, events: false, ...args },
      rawArgs: [],
      cmd: frames,
    } as never);
    return JSON.parse(String(log.mock.calls.at(-1)?.[0]));
  } finally {
    log.mockRestore();
  }
}

describe.skipIf(!ffmpeg || !findFFprobe())("measure frames", () => {
  it("leaves files already in the output folder alone while it builds sheets", async () => {
    const clip = join(dir, "t.mp4");
    execFileSync(ffmpeg!, [
      ...["-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=160x90:d=2:r=10"],
      ...["-pix_fmt", "yuv420p", "-c:v", "libx264", clip],
    ]);
    const out = join(dir, "out");
    mkdirSync(out);
    const theirs = ["every-0-00.png", "range-00.png", "w1-00.png"];
    for (const name of theirs) writeFileSync(join(out, name), "not ours");
    expect((await run({ video: clip, every: "0.5", out })).ok).toBe(true);
    expect((await run({ video: clip, range: "0,1", out })).ok).toBe(true);
    for (const name of theirs) expect(existsSync(join(out, name))).toBe(true);
    expect(readdirSync(out).filter((n) => n.startsWith(".frames-"))).toEqual([]);
  });
});
