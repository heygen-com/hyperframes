import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProjectRelativeSrc } from "@hyperframes/engine";
import {
  dropMediaOutsideProject,
  preflightCompositionAssetMediaTypes,
} from "../../assetMediaType.js";
import { runAudioStage } from "./audioStage.js";
import { materializeDataAudioSources } from "./runtimeAudio.js";

/** Builds a valid 16-bit stereo 48 kHz RIFF/PCM WAV buffer of the requested duration. */
function makeSilenceWav(durationSeconds = 0.25): Buffer {
  const sampleRate = 48_000;
  const channels = 2;
  const bitsPerSample = 16;
  const numSamples = Math.max(1, Math.round(sampleRate * durationSeconds));
  const dataSize = numSamples * channels * (bitsPerSample / 8);
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  buf.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

describe("runtime audio materialization — real FFmpeg pipeline", () => {
  // Real end-to-end check: materialized WAV passes asset-root check, FFprobe preflight, and FFmpeg audioStage.
  it("mixes materialized inline audio through dropMediaOutsideProject, preflight, and runAudioStage", async () => {
    const root = mkdtempSync(join(tmpdir(), "hf-rt-e2e-"));
    const projectDir = join(root, "project");
    const workDir = join(root, "work");
    const compiledDir = join(workDir, "compiled");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(compiledDir, { recursive: true });

    const wav = makeSilenceWav(0.3);
    const composition = {
      videos: [],
      images: [],
      audios: [
        {
          id: "audio-morning-ambience",
          src: `data:audio/wav;base64,${wav.toString("base64")}`,
          start: 0,
          end: 0.3,
          mediaStart: 0,
          loop: false,
          layer: 0,
          volume: 1,
          type: "audio" as const,
        },
      ],
    };
    const log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    try {
      materializeDataAudioSources({ audios: composition.audios, compiledDir, log });
      const resolved = resolveProjectRelativeSrc(
        composition.audios[0]!.src,
        projectDir,
        compiledDir,
      );
      expect(existsSync(resolved)).toBe(true);

      dropMediaOutsideProject({
        projectDir,
        workDir,
        composition,
        log,
        allowOutsideProjectAssets: false,
      });
      expect(composition.audios).toHaveLength(1);

      await preflightCompositionAssetMediaTypes({ projectDir, compiledDir, composition });

      const result = await runAudioStage({
        projectDir,
        workDir,
        compiledDir,
        totalFrames: 9,
        fps: { num: 30, den: 1 },
        ffmpegProcessTimeout: 30_000,
        audioGain: 1,
        audios: composition.audios,
        allowOutsideProjectAssets: false,
        abortSignal: undefined,
        assertNotAborted: () => {},
        log,
      });

      expect(result.hasAudio).toBe(true);
      expect(result.audioError).toBeUndefined();
      expect(existsSync(result.audioOutputPath)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
