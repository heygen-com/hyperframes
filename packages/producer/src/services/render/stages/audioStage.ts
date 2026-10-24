/**
 * audioStage — mix the composition's audio tracks into
 * `workDir/<MIXED_AUDIO_FILENAME>`.
 *
 * Trivial wrapper around `processCompositionAudio`. The stage is skipped
 * (no ffmpeg invocation) when the composition has no audio elements; the
 * timer is still set so the perf summary stays consistent across renders.
 *
 * Hard constraints preserved verbatim:
 *   - `audioOutputPath` is always `join(workDir, MIXED_AUDIO_FILENAME)`,
 *     regardless of whether any audio was actually produced. The engine owns
 *     that filename because its extension selects the muxer (see the constant).
 *   - `hasAudio` reflects `audioResult.success` from
 *     `processCompositionAudio`; it is `false` when there are no audio
 *     elements (skips the call entirely) and also when the call returns
 *     `success: false`.
 *   - `perfStages.audioProcessMs` is set whether or not the call ran.
 */

import { join } from "node:path";
import { rmSync } from "node:fs";
import type { Fps } from "@hyperframes/core";
import {
  MIXED_AUDIO_FILENAME,
  audioFailureDiagnostics,
  processCompositionAudio,
  type AudioProcessingFailure,
} from "@hyperframes/engine";
import type { CompositionMetadata } from "../shared.js";
import type { ProducerLogger } from "../../../logger.js";
import { encoderFailureError } from "../encoderInterruption.js";
import { constrainAacTruePeak } from "../audioPadTrim.js";

export interface AudioStageInput {
  projectDir: string;
  workDir: string;
  /** `join(workDir, "compiled")`; passed through to the audio mixer for asset resolution. */
  compiledDir: string;
  /** Probed video frame count and exact frame rate define the delivered audio length. */
  totalFrames: number;
  fps: Fps;
  /** Timeout forwarded to ffmpeg subprocesses used by the audio mixer. */
  ffmpegProcessTimeout: number;
  /** Master gain forwarded to the audio mixer. */
  audioGain: number;
  /** Read-only view of `composition.audios`. */
  audios: CompositionMetadata["audios"];
  masterFxChain?: string;
  urlByAbsentLocalPath?: ReadonlyMap<string, string>;
  audioSidecarUrlByLocalPath?: ReadonlyMap<string, string>;
  abortSignal: AbortSignal | undefined;
  assertNotAborted: () => void;
  /** Where a per-track failure's detail goes. Optional so tests need not pass one. */
  log?: ProducerLogger;
}

export interface AudioStageResult {
  /** Actual delivery attenuation, for the render warning and metadata. */
  audioLoweredDb?: number;
  /** Always `join(workDir, MIXED_AUDIO_FILENAME)`. */
  audioOutputPath: string;
  /** True iff the audio mix actually produced a file. False when there are no audio elements. */
  hasAudio: boolean;
  /** Wall-clock ms for the audio mix phase. Zero-elements path is near-zero but always set. */
  audioProcessMs: number;
  /**
   * Set when `audios.length > 0` but the mix failed (`hasAudio` is `false`
   * despite audio being expected) — the caller should surface this. `undefined`
   * both when there was no audio to mix and when the mix succeeded.
   */
  audioError?: string;
  /** Bounded typed causes for policy, telemetry, and caller classification. */
  audioFailures?: AudioProcessingFailure[];
}

function assertAudioNotInterrupted(failures: readonly AudioProcessingFailure[] | undefined): void {
  const interrupted = failures?.find((failure) => failure.reason === "external_interruption");
  if (!interrupted) return;
  throw encoderFailureError("Audio processing failed", {
    error: interrupted.detail,
    failureReason: "external_interruption",
    audioFailures: audioFailureDiagnostics([
      interrupted,
      ...(failures ?? []).filter((failure) => failure !== interrupted),
    ]),
  });
}

export async function runAudioStage(input: AudioStageInput): Promise<AudioStageResult> {
  const stageStart = Date.now();
  const pcmSourcePath = join(input.workDir, "audio-source.wav");
  const duration = (input.totalFrames * input.fps.den) / input.fps.num;
  try {
    const result = await mixAudioForDelivery(input, duration, pcmSourcePath);
    let audioLoweredDb: number | undefined;
    if (result.hasAudio) {
      const peak = await constrainAacTruePeak({
        audioPath: result.audioOutputPath,
        sourcePath: pcmSourcePath,
        targetDurationSeconds: duration,
        signal: input.abortSignal,
        timeoutMs: input.ffmpegProcessTimeout,
      });
      if (!peak.success) throw encoderFailureError("Audio true-peak check failed", peak);
      audioLoweredDb = peak.loweredDb;
    }
    return { ...result, audioLoweredDb, audioProcessMs: Date.now() - stageStart };
  } finally {
    rmSync(pcmSourcePath, { force: true });
  }
}

async function mixAudioForDelivery(
  input: AudioStageInput,
  duration: number,
  pcmSourcePath: string,
): Promise<Omit<AudioStageResult, "audioProcessMs">> {
  const {
    projectDir,
    workDir,
    compiledDir,
    ffmpegProcessTimeout,
    audioGain,
    audios,
    masterFxChain,
    urlByAbsentLocalPath,
    audioSidecarUrlByLocalPath,
    abortSignal,
    assertNotAborted,
    log,
  } = input;

  const audioOutputPath = join(workDir, MIXED_AUDIO_FILENAME);
  let hasAudio = false;
  let audioError: string | undefined;
  let audioFailures: AudioProcessingFailure[] | undefined;

  if (audios.length > 0) {
    // processCompositionAudio reports per-track failures in its result, but an FX
    // failure it cannot degrade past — a browser that will not launch, a chain
    // that will not build — rejects instead. Caught here so it lands in
    // `audioError` with the rest, rather than escaping as an unclassified
    // pipeline exception and losing the stage/owner/retryable classification
    // this stage exists to attach.
    let audioResult: Awaited<ReturnType<typeof processCompositionAudio>>;
    try {
      audioResult = await processCompositionAudio(
        audios,
        projectDir,
        join(workDir, "audio-work"),
        audioOutputPath,
        duration,
        abortSignal,
        {
          ffmpegProcessTimeout,
          audioGain,
          masterFxChain,
          urlByAbsentLocalPath,
          audioSidecarUrlByLocalPath,
          keepEncoderInputAt: pcmSourcePath,
        },
        compiledDir,
      );
    } catch (err) {
      // An abort is the caller's own signal and must keep its own shape.
      assertNotAborted();
      const detail = err instanceof Error ? err.message : String(err);
      return {
        audioOutputPath,
        hasAudio: false,
        audioError: detail,
        // Synthesised rather than left undefined. The warning policy reads
        // owner, retryability, reason and stage off this list, so reporting the
        // FATAL failure — the one that took the whole mix down — with an empty
        // one gave it strictly less classification than a single dropped track
        // gets, which is the opposite of what this stage exists to do.
        // "internal" is the honest bucket: the stages enumerate ffmpeg steps
        // and this is the FX render, which is none of them.
        audioFailures: [
          {
            stage: "internal",
            reason: "internal",
            owner: "system",
            retryable: false,
            detail: detail.slice(0, 2_000),
          },
        ],
      };
    }
    assertNotAborted();

    assertAudioNotInterrupted(audioResult.failures);

    hasAudio = audioResult.success;
    audioFailures = audioResult.failures;
    // processCompositionAudio's error (per-element failures or the mix's own
    // error) used to be discarded here — the caller only saw hasAudio flip to
    // false with no explanation, so a real audio failure looked identical to
    // "no audio was authored" and shipped a silent video-only render.
    if (!hasAudio) {
      audioError = audioResult.error ?? "audio mix failed for an unknown reason";
      // Each failure's `detail` names the element and what went wrong with it,
      // and it was going nowhere: the render printed the warning code and
      // dropped everything that said why, so an audio failure could only be
      // diagnosed by re-running the mixer by hand outside the pipeline.
      for (const failure of audioResult.failures ?? []) {
        log?.warn("Audio track failed", {
          elementId: failure.elementId,
          stage: failure.stage,
          reason: failure.reason,
          owner: failure.owner,
          retryable: failure.retryable,
          detail: failure.detail,
        });
      }
    }
  }

  return {
    audioOutputPath,
    hasAudio,
    audioError,
    audioFailures,
  };
}
