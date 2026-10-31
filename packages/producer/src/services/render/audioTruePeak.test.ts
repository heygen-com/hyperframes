import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getFfmpegBinary } from "@hyperframes/engine";
import { measureTruePeakDbfs } from "./audioTruePeak.js";

const RATE = 48_000;
const SECONDS = 180; // three segments: cuts at 60 s and 120 s, each later one starting 4800 samples early
const CUT = 60 * RATE;
const BLOCK = RATE / 10;
// From silence, a scan that starts on this burst reads it 0.7 dB louder than a whole-file scan.
const BURST = [-0.45, 0.9, -0.9];

const hasFfmpeg = (() => {
  try {
    execFileSync(getFfmpegBinary(), ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const dir = mkdtempSync(join(tmpdir(), "hf-true-peak-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function monoWav(name: string, burstAt?: number): string {
  const data = Buffer.alloc(SECONDS * RATE * 2);
  if (burstAt !== undefined) {
    BURST.forEach((v, i) => data.writeInt16LE(Math.round(v * 32767), (burstAt + i) * 2));
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  const path = join(dir, `${name}.wav`);
  writeFileSync(path, Buffer.concat([header, data]));
  return path;
}

async function bothWays(path: string): Promise<[number, number]> {
  const { stderr } = spawnSync(
    getFfmpegBinary(),
    ["-nostdin", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const whole = [...stderr.matchAll(/^\s*Peak:\s*(\S+) dBFS$/gm)].at(-1)?.[1];
  const segmented = await measureTruePeakDbfs(path, { timeoutMs: 60_000 });
  return [whole === "-inf" ? Number.NEGATIVE_INFINITY : Number(whole), segmented];
}

describe.skipIf(!hasFfmpeg)("measureTruePeakDbfs in segments", () => {
  it.each([
    ["ends on a segment cut", CUT - BURST.length],
    ["starts where a middle segment's scan starts", CUT - BLOCK],
    ["starts where the last segment's scan starts", 2 * CUT - BLOCK],
  ])(
    "reads a peak that %s exactly as one whole-file pass",
    async (_, at) => {
      const [whole, segmented] = await bothWays(monoWav(`burst-${at}`, at));
      expect(whole).toBeGreaterThan(-1);
      expect(segmented).toBe(whole);
    },
    60_000,
  );

  it.each([
    ["ends on a segment cut", CUT - BURST.length],
    ["starts where the last segment's scan starts", 2 * CUT - BLOCK],
  ])(
    "reads an AAC peak that %s exactly as one whole-file pass",
    async (_, at) => {
      const wav = monoWav(`aac-burst-${at}`, at);
      const aac = wav.replace(/\.wav$/, ".m4a");
      execFileSync(getFfmpegBinary(), ["-nostdin", "-v", "error", "-i", wav, "-c:a", "aac", aac]);
      const [whole, segmented] = await bothWays(aac);
      expect(whole).toBeGreaterThan(-10);
      expect(segmented).toBe(whole);
    },
    60_000,
  );

  it("reads silence as -inf", async () => {
    expect(await bothWays(monoWav("silence"))).toEqual([
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]);
  }, 60_000);
});
