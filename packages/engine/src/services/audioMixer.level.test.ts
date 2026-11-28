import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getFfmpegBinary } from "../utils/ffmpegBinaries.js";
import { MIXED_AUDIO_FILENAME, parseAudioElements, processCompositionAudio } from "./audioMixer.js";

const HAS_FFMPEG = spawnSync(getFfmpegBinary(), ["-version"], { encoding: "utf-8" }).status === 0;
const tempDirs: string[] = [];

function meanVolumeDb(path: string): number {
  const result = spawnSync(
    getFfmpegBinary(),
    ["-nostdin", "-hide_banner", "-i", path, "-af", "volumedetect", "-f", "null", "-"],
    { encoding: "utf-8" },
  );
  const match = result.stderr.match(/mean_volume:\s*(-?[\d.]+) dB/);
  if (result.status !== 0 || !match?.[1]) {
    throw new Error(`Could not measure mean volume: ${result.stderr}`);
  }
  return Number(match[1]);
}

/** Seconds until the first sample loud enough to be signal rather than codec noise. */
function firstAudibleSeconds(path: string): number {
  const sampleRate = 48_000;
  const result = spawnSync(
    getFfmpegBinary(),
    [
      "-nostdin",
      "-v",
      "error",
      "-i",
      path,
      "-map",
      "0:a",
      "-ac",
      "1",
      "-ar",
      String(sampleRate),
      "-f",
      "s16le",
      "-",
    ],
    { maxBuffer: 1 << 28 },
  );
  if (result.status !== 0) {
    throw new Error(`Could not decode ${path}: ${result.stderr?.toString()}`);
  }
  const pcm = result.stdout;
  for (let i = 0; i < pcm.length / 2; i += 1) {
    if (Math.abs(pcm.readInt16LE(i * 2)) > 512) return i / sampleRate;
  }
  throw new Error(`No audible sample found in ${path}`);
}

// Same real-ffmpeg exposure as audioMixer.grouping.test.ts, which timed out on a
// Windows runner at vitest's default 5s. This one has not failed yet; it is one
// spawn slower away from it.
describe.skipIf(!HAS_FFMPEG)(
  "processCompositionAudio levels",
  () => {
    afterEach(() => {
      for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    it("preserves the level of a mono source in the stereo mix", async () => {
      const projectDir = mkdtempSync(join(tmpdir(), "hf-mono-level-"));
      const workDir = mkdtempSync(join(tmpdir(), "hf-mono-work-"));
      tempDirs.push(projectDir, workDir);
      const sourcePath = join(projectDir, "voice.wav");
      const outputPath = join(projectDir, "audio.aac");
      const setup = spawnSync(
        getFfmpegBinary(),
        [
          "-nostdin",
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=1000:duration=1:sample_rate=48000",
          "-ac",
          "1",
          "-c:a",
          "pcm_s16le",
          sourcePath,
        ],
        { encoding: "utf-8" },
      );
      expect(setup.status, setup.stderr).toBe(0);

      const result = await processCompositionAudio(
        [
          {
            id: "voice",
            src: "voice.wav",
            start: 0,
            end: 1,
            mediaStart: 0,
            layer: 0,
            volume: 1,
            type: "audio",
          },
        ],
        projectDir,
        workDir,
        outputPath,
        1,
      );

      expect(result.success).toBe(true);
      expect(meanVolumeDb(outputPath) - meanVolumeDb(sourcePath)).toBeGreaterThan(-0.3);
    });

    it("places a delayed track on its authored start, not one AAC frame later", async () => {
      // The mix is AAC-encoded, and AAC encoders emit ~1024 priming samples. A
      // raw ADTS container has nowhere to record that delay, so it decodes as
      // real leading silence and drags the whole track 21.33 ms late against a
      // frame-accurate video. MIXED_AUDIO_FILENAME picks a container that stores
      // the delay as an edit list instead; this asserts the artifact we actually
      // ship lands on time.
      const projectDir = mkdtempSync(join(tmpdir(), "hf-onset-"));
      const workDir = mkdtempSync(join(tmpdir(), "hf-onset-work-"));
      tempDirs.push(projectDir, workDir);
      const sourcePath = join(projectDir, "tone.wav");
      const outputPath = join(projectDir, MIXED_AUDIO_FILENAME);
      const setup = spawnSync(
        getFfmpegBinary(),
        [
          "-nostdin",
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=1000:duration=1:sample_rate=48000",
          "-c:a",
          "pcm_s16le",
          sourcePath,
        ],
        { encoding: "utf-8" },
      );
      expect(setup.status, setup.stderr).toBe(0);

      const result = await processCompositionAudio(
        [
          {
            id: "tone",
            src: "tone.wav",
            start: 2,
            end: 3,
            mediaStart: 0,
            layer: 0,
            volume: 1,
            type: "audio",
          },
        ],
        projectDir,
        workDir,
        outputPath,
        4,
      );

      expect(result.success).toBe(true);
      expect(firstAudibleSeconds(outputPath)).toBeCloseTo(2, 2);
    });

    it.each([
      { loop: false, ramped: false },
      { loop: true, ramped: false },
      { loop: false, ramped: true },
      { loop: true, ramped: true },
    ])(
      "preserves the normalized surround mix level (loop=$loop, ramped=$ramped)",
      async ({ loop, ramped }) => {
        const dir = mkdtempSync(join(tmpdir(), "hf-surround-level-"));
        tempDirs.push(dir);
        const sourcePath = join(dir, "surround.wav");
        const setup = spawnSync(getFfmpegBinary(), [
          "-nostdin",
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "aevalsrc=0.3*sin(2*PI*1000*t)|0.2*sin(2*PI*700*t)|0.1*sin(2*PI*400*t)|0|0|0:c=5.1:s=48000:d=1",
          "-c:a",
          "pcm_s16le",
          sourcePath,
        ]);
        expect(setup.status, setup.stderr.toString()).toBe(0);
        const control = spawnSync(getFfmpegBinary(), [
          "-nostdin",
          "-v",
          "error",
          "-i",
          sourcePath,
          "-ac",
          "2",
          "-c:a",
          "pcm_s16le",
          join(dir, "stereo.wav"),
        ]);
        expect(control.status, control.stderr.toString()).toBe(0);

        const duration = loop ? 2 : 1;
        const levels: number[] = [];
        for (const name of ["surround", "stereo"]) {
          const outputPath = join(dir, `${name}.m4a`);
          const elements = parseAudioElements(
            `<audio id="tone" src="${name}.wav" data-start="0" data-duration="${duration}" ${loop ? "loop" : ""}></audio>`,
          );
          if (ramped) {
            for (const element of elements) {
              element.playbackRate = {
                target: "rate",
                points: [
                  { t: 0, v: 0.7 },
                  { t: duration, v: 1.2 },
                ],
              };
            }
          }
          const result = await processCompositionAudio(
            elements,
            dir,
            join(dir, name),
            outputPath,
            duration,
          );
          expect(result.success, result.error).toBe(true);
          levels.push(meanVolumeDb(outputPath));
        }
        const [surround, stereo] = levels;
        if (surround === undefined || stereo === undefined)
          throw new Error("Both mixes need levels");
        expect(Math.abs(surround - stereo)).toBeLessThan(0.2);
      },
    );

    it.each([false, true])(
      "preserves a boosted clip's waveform through a unity volume lane (loop=%s)",
      async (loop) => {
        const dir = mkdtempSync(join(tmpdir(), "hf-envelope-headroom-"));
        tempDirs.push(dir);
        const setup = spawnSync(getFfmpegBinary(), [
          "-nostdin",
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "aevalsrc=0.6*sin(2*PI*1000*t):s=48000:d=1",
          "-c:a",
          "pcm_s16le",
          join(dir, "tone.wav"),
        ]);
        expect(setup.status, setup.stderr.toString()).toBe(0);

        const duration = loop ? 2 : 1;
        const lane = JSON.stringify({
          version: 1,
          lanes: [
            {
              target: "volume",
              points: [
                { t: 0, v: 1 },
                { t: duration, v: 1 },
              ],
            },
          ],
        });
        const decoded: Buffer[] = [];
        for (const automated of [false, true]) {
          const name = automated ? "automated" : "static";
          const outputPath = join(dir, `${name}.m4a`);
          const elements = parseAudioElements(`
            <hf-audio-group id="bus" data-volume="0.5"></hf-audio-group>
            <audio id="tone" src="tone.wav" data-start="0" data-duration="${duration}"
              data-volume="2" data-audio-group="bus" ${loop ? "loop" : ""}
              ${automated ? `data-automation='${lane}'` : ""}></audio>
          `);
          const result = await processCompositionAudio(
            elements,
            dir,
            join(dir, name),
            outputPath,
            duration,
          );
          expect(result.success, result.error).toBe(true);
          const pcm = spawnSync(getFfmpegBinary(), [
            "-nostdin",
            "-v",
            "error",
            "-i",
            outputPath,
            "-af",
            "pan=mono|c0=c0",
            "-f",
            "f32le",
            "-",
          ]);
          expect(pcm.status, pcm.stderr.toString()).toBe(0);
          decoded.push(pcm.stdout);
        }

        const [control, automated] = decoded;
        if (!control || !automated) throw new Error("Both mixes must decode");
        let errorEnergy = 0;
        let signalEnergy = 0;
        for (let i = 12_000; i < (duration - 0.25) * 48_000; i += 1) {
          const sample = control.readFloatLE(i * 4);
          const difference = automated.readFloatLE(i * 4) - sample;
          errorEnergy += difference * difference;
          signalEnergy += sample * sample;
        }
        expect(Math.sqrt(signalEnergy)).toBeGreaterThan(1);
        expect(Math.sqrt(errorEnergy / signalEnergy)).toBeLessThan(0.005);
      },
    );
  },
  60_000,
);
