import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getFfmpegBinary } from "../utils/ffmpegBinaries.js";
import { parseAudioElements, processCompositionAudio } from "./audioMixer.js";

const FFMPEG = getFfmpegBinary();
const HAS_FFMPEG = spawnSync(FFMPEG, ["-version"]).status === 0;
const SAMPLE_RATE = 48_000;

function ffmpeg(args: string[]): Buffer {
  const result = spawnSync(FFMPEG, ["-nostdin", "-v", "error", "-y", ...args]);
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return result.stdout;
}

function frequenciesAt(pcm: Buffer, times: number[]): Array<number | null> {
  return times.map((time) => {
    const start = Math.round((time - 0.04) * SAMPLE_RATE);
    const count = Math.round(0.08 * SAMPLE_RATE);
    let energy = 0;
    let crossings = 0;
    let previous = 0;
    for (let i = start; i < start + count; i += 1) {
      const sample = pcm.readInt16LE(i * 2);
      energy += sample * sample;
      if (i > start && previous < 0 && sample >= 0) crossings += 1;
      previous = sample;
    }
    return Math.sqrt(energy / count) < 30 ? null : Math.round(crossings / 0.08 / 100) * 100;
  });
}

/** A copy of a canonical 44-byte-header WAV with its fmt chunk's byte rate and block align overwritten. */
function withHeader(source: string, target: string, byteRate: number, blockAlign: number): void {
  const wav = Buffer.from(readFileSync(source));
  expect(wav.toString("ascii", 36, 40)).toBe("data");
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  writeFileSync(target, wav);
}

describe.skipIf(!HAS_FFMPEG)("a WAV whose header misstates its byte rate", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-audio-byterate-"));
    // 8 s of 24 kHz mono speech-rate PCM, a different pitch each second.
    ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=0.3*sin(2*PI*(400+400*floor(t))*t):s=24000:d=8",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      "-bitexact",
      "-map_metadata",
      "-1",
      join(dir, "true.wav"),
    ]);
    // Written as if the mono samples were stereo: 96,000 bytes a second for 48,000.
    withHeader(join(dir, "true.wav"), join(dir, "double-rate.wav"), 96_000, 2);
    withHeader(join(dir, "true.wav"), join(dir, "stereo-header.wav"), 96_000, 4);
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  async function render(src: string): Promise<Buffer> {
    const work = mkdtempSync(join(dir, "work-"));
    const output = `${work}.m4a`;
    const html = `<audio id="voice" src="${src}" data-start="0" data-duration="4" data-media-start="3"></audio>`;
    const result = await processCompositionAudio(parseAudioElements(html), dir, work, output, 4);
    expect(result, result.error).toMatchObject({ success: true, tracksProcessed: 1 });
    return ffmpeg(["-i", output, "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "-"]);
  }

  const heardAt = [0.5, 1.5, 2.5, 3.5];

  it.each(["double-rate.wav", "stereo-header.wav"])(
    "%s plays the same words as the true file from its in-point, for the whole clip",
    async (src) => {
      const reference = frequenciesAt(await render("true.wav"), heardAt);
      expect(reference).toEqual([1600, 2000, 2400, 2800]);
      expect(frequenciesAt(await render(src), heardAt)).toEqual(reference);
    },
  );
});
