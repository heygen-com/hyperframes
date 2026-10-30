import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { findFFmpeg, findFFprobe } from "../../browser/ffmpeg.js";
import probe from "./probe.js";

const ffmpeg = findFFmpeg();
const dir = mkdtempSync(join(tmpdir(), "hf-probe-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function run(args: Record<string, unknown>) {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await probe.run!({ args: { json: false, ...args }, rawArgs: [], cmd: probe } as never);
    return JSON.parse(String(log.mock.calls.at(-1)?.[0]));
  } finally {
    log.mockRestore();
  }
}

describe.skipIf(!ffmpeg || !findFFprobe())("measure probe", () => {
  it("gives a variable-rate video's canvas its real length, normalized or not", async () => {
    // 60 fps for 5 s, then every other frame: 450 frames over 10 s, nominally 60 fps.
    const vfr = join(dir, "vfr.mp4");
    execFileSync(ffmpeg!, [
      ...["-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=160x90:d=10:r=60"],
      ...["-vf", "select='lt(t,5)+not(mod(n,2))'", "-fps_mode", "passthrough"],
      ...["-c:v", "libx264", "-pix_fmt", "yuv420p", vfr],
    ]);
    const plain = await run({ video: vfr });
    expect(plain.vfr).toBe(true);
    expect(plain.canvas.duration).toBeCloseTo(10, 0);
    const made = await run({ video: vfr, normalize: join(dir, "norm.mp4") });
    expect(made.canvas.duration).toBeCloseTo(10, 0);
  });
});
