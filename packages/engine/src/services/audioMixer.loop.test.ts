import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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

describe.skipIf(!HAS_FFMPEG)(
  "looped audio export",
  () => {
    let dir: string;

    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "hf-audio-loop-"));
      ffmpeg([
        "-f",
        "lavfi",
        "-i",
        `aevalsrc=0.1*sin(2*PI*(400+400*floor(t))*t):s=${SAMPLE_RATE}:d=3`,
        join(dir, "steps.wav"),
      ]);
      ffmpeg([
        "-f",
        "lavfi",
        "-i",
        "color=size=64x36:rate=10:duration=3",
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=1000:sample_rate=${SAMPLE_RATE}:duration=1`,
        "-c:v",
        "mpeg4",
        "-c:a",
        "pcm_s16le",
        join(dir, "short-audio.mov"),
      ]);
    });

    afterAll(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    async function render(html: string, duration: number): Promise<Buffer> {
      const work = mkdtempSync(join(dir, "work-"));
      const output = `${work}.m4a`;
      const result = await processCompositionAudio(
        parseAudioElements(html),
        dir,
        work,
        output,
        duration,
      );
      expect(result, result.error).toMatchObject({ success: true, tracksProcessed: 1 });
      return ffmpeg(["-i", output, "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "-"]);
    }

    it("repeats only the source after the in-point and stops at the slot end", async () => {
      const pcm = await render(
        '<audio id="bed" src="steps.wav" data-start="0.5" data-end="5" data-media-start="1" loop></audio>',
        6,
      );
      expect(frequenciesAt(pcm, [0.2, 0.75, 1.75, 2.75, 3.75, 4.75, 5.5])).toEqual([
        null,
        800,
        1200,
        800,
        1200,
        800,
        null,
      ]);
      expect(pcm.length / 2 / SAMPLE_RATE).toBeCloseTo(6, 1);
    });

    it("keeps ordinary audio silent after EOF", async () => {
      const pcm = await render(
        '<audio id="voice" src="steps.wav" data-start="0" data-end="5" data-media-start="1"></audio>',
        5,
      );
      expect(frequenciesAt(pcm, [0.5, 1.5, 2.5, 4.5])).toEqual([800, 1200, null, null]);
    });

    it.each([
      {
        rate: 2,
        duration: 3,
        times: [0.25, 0.75, 1.25, 1.75, 2.25, 2.75],
        heard: [800, 1200, 800, 1200, 800, 1200],
      },
      { rate: 0.5, duration: 5, times: [0.5, 2.5, 4.5], heard: [800, 1200, 800] },
    ])(
      "applies $rate x speed to the repeated trimmed cycle",
      async ({ rate, duration, times, heard }) => {
        const pcm = await render(
          `<audio id="speed" src="steps.wav" data-start="0" data-end="${duration}" data-media-start="1" data-playback-rate="${rate}" loop></audio>`,
          duration,
        );
        expect(frequenciesAt(pcm, times)).toEqual(heard);
      },
    );

    it("feeds repeated source audio into the existing rate-lane baker", async () => {
      const lane = JSON.stringify({
        version: 1,
        lanes: [
          {
            target: "rate",
            points: [
              { t: 0, v: 1 },
              { t: 2, v: 3 },
            ],
          },
        ],
      });
      const pcm = await render(
        `<audio id="ramp" src="steps.wav" data-start="0" data-end="2" data-media-start="1" data-automation='${lane}' loop></audio>`,
        2,
      );
      expect(frequenciesAt(pcm, [0.2, 1.1, 1.4, 1.9])).toEqual([800, 1200, 800, 1200]);
    });

    it("keeps a video's silent tail inside every loop cycle", async () => {
      const pcm = await render(
        '<video id="clip" src="short-audio.mov" data-has-audio="true" data-start="0" data-end="7" loop></video>',
        7,
      );
      expect(frequenciesAt(pcm, [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5])).toEqual([
        1000,
        null,
        null,
        1000,
        null,
        null,
        1000,
      ]);
    });

    it("leaves muted videos and hidden audio out of the mix", () => {
      expect(
        parseAudioElements(`
      <video id="muted" src="short-audio.mov" data-has-audio="true" muted loop></video>
      <video id="silent" src="short-audio.mov" loop></video>
      <audio id="hidden" src="steps.wav" data-hidden="true" loop></audio>
    `),
      ).toEqual([]);
    });
  },
  30_000,
);
