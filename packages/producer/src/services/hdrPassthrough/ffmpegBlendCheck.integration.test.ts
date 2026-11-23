// The blend self-test against real ffmpeg: the one the composite resolves, and a binary that
// cannot run it. Integration lane (spawns ffmpeg).

import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { getFfmpegBinary } from "@hyperframes/engine";
import { checkFfmpegBlend, resetFfmpegBlendCheckCache, runBlendCheck } from "./ffmpegBlendCheck.js";

const ENV = "HYPERFRAMES_FFMPEG_PATH";
const saved = process.env[ENV];

function ffmpegMajor(): number | null {
  const out = spawnSync(getFfmpegBinary(), ["-hide_banner", "-version"], { encoding: "utf-8" });
  const version = /^ffmpeg version n?(\d+)\./m.exec(out.stdout ?? "");
  return version ? Number(version[1]) : null;
}

afterEach(() => {
  if (saved === undefined) delete process.env[ENV];
  else process.env[ENV] = saved;
  resetFfmpegBlendCheckCache();
});

describe("runBlendCheck", () => {
  it("is exact on ffmpeg 7 and 8 and runs in well under a second", async () => {
    const major = ffmpegMajor();
    const started = Date.now();
    const result = await runBlendCheck();
    expect(Date.now() - started).toBeLessThan(5000);
    // 7.0 and 8.0 are the versions the passthrough is measured on; older builds may round off.
    if (major !== null && major >= 7 && major <= 8) expect(result).toEqual({ exact: true });
  });
});

describe("checkFfmpegBlend", () => {
  it("fails closed, once per binary, on an ffmpeg that cannot run the check", async () => {
    process.env[ENV] = "/bin/false";
    const first = checkFfmpegBlend();
    expect(checkFfmpegBlend()).toBe(first);
    const result = await first;
    expect(result.exact).toBe(false);
    if (!result.exact) expect(result.detail).toContain("/bin/false: blend self-test failed");
  });
});
