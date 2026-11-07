import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { encodeAac, getFfmpegBinary, resolveHeadlessShellPath } from "@hyperframes/engine";
import { limitDeliveryPeaks } from "./audioDeliveryLimit.js";
import { measureTruePeakDbfs } from "./audioTruePeak.js";

const ready = (path: string | undefined | null, flag: string) =>
  !!path && spawnSync(path, [flag], { encoding: "utf8" }).status === 0;
const browser = (() => {
  try {
    return resolveHeadlessShellPath();
  } catch {
    // A configured path that does not exist: no browser to limit with.
    return null;
  }
})();
const CAN_RUN = ready(getFfmpegBinary(), "-version") && ready(browser, "--version");

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A drum hit every 0.5 s over a quiet bed, true peak about +0.1 dBTP, as float PCM; and its AAC. */
async function mixOverTheCeiling() {
  const dir = mkdtempSync(join(tmpdir(), "hf-delivery-limit-"));
  dirs.push(dir);
  const sourcePath = join(dir, "audio-source.wav");
  const hit = "0.98*sin(2*PI*90*t)*exp(-mod(t,0.5)*25)";
  const made = spawnSync(getFfmpegBinary(), [
    ...["-v", "error", "-y", "-f", "lavfi", "-i"],
    `aevalsrc='${hit}+0.02*sin(2*PI*1000*t)|${hit}+0.02*sin(2*PI*1500*t)':s=48000:d=6`,
    ...["-c:a", "pcm_f32le", sourcePath],
  ]);
  if (made.status !== 0) throw new Error(String(made.stderr));
  const audioPath = join(dir, "audio.m4a");
  const encoded = await encodeAac(sourcePath, audioPath, 6, { timeout: 60_000 });
  if (!encoded.success) throw new Error(encoded.stderr);
  return { sourcePath, audioPath };
}

describe.skipIf(!CAN_RUN)("limitDeliveryPeaks on a real mix", () => {
  // fails without the fix: one pass at a fixed -3 dBTP left this mix at about -2.9 dBTP, 1.9 dB more off every hit
  // than the -1 dBTP rule asks.
  it("brings the encode under -1 dBTP losing no more than 0.2 dB past it, the same bytes every time", async () => {
    const runs = [];
    for (let run = 0; run < 2; run++) {
      const mix = await mixOverTheCeiling();
      const before = await measureTruePeakDbfs(mix.audioPath, { timeoutMs: 60_000 });
      expect(before).toBeGreaterThan(-1);
      const limited = await limitDeliveryPeaks({
        ...mix,
        targetDurationSeconds: 6,
        timeoutMs: 120_000,
      });
      expect(limited.success).toBe(true);
      const after = await measureTruePeakDbfs(mix.audioPath, { timeoutMs: 60_000 });
      runs.push({
        after,
        bytes: createHash("sha256").update(readFileSync(mix.audioPath)).digest("hex"),
      });
    }
    expect(runs[0]!.after).toBeLessThanOrEqual(-1);
    expect(runs[0]!.after).toBeGreaterThanOrEqual(-1.2);
    expect(runs[1]!.bytes).toBe(runs[0]!.bytes);
  }, 300_000);
});
