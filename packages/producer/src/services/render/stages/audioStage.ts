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
import {
  MIXED_AUDIO_FILENAME,
  processCompositionAudio,
  type AudioProcessingFailure,
} from "@hyperframes/engine";
import type { CompositionMetadata } from "../shared.js";

export interface AudioStageInput {
  projectDir: string;
  workDir: string;
  /** `join(workDir, "compiled")`; passed through to the audio mixer for asset resolution. */
  compiledDir: string;
  /** Composition duration (post-probe). Must be > 0 — probeStage guarantees this. */
  duration: number;
  /** Read-only view of `composition.audios`. */
  audios: CompositionMetadata["audios"];
  abortSignal: AbortSignal | undefined;
  assertNotAborted: () => void;
}

export interface AudioStageResult {
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

export async function runAudioStage(input: AudioStageInput): Promise<AudioStageResult> {
  const { projectDir, workDir, compiledDir, duration, audios, abortSignal, assertNotAborted } =
    input;

  const stage3Start = Date.now();
  const audioOutputPath = join(workDir, MIXED_AUDIO_FILENAME);
  let hasAudio = false;
  let audioError: string | undefined;
  let audioFailures: AudioProcessingFailure[] | undefined;

  if (audios.length > 0) {
    const audioResult = await processCompositionAudio(
      audios,
      projectDir,
      join(workDir, "audio-work"),
      audioOutputPath,
      duration,
      abortSignal,
      undefined,
      compiledDir,
    );
    assertNotAborted();

    hasAudio = audioResult.success;
    audioFailures = audioResult.failures;
    // processCompositionAudio's error (per-element failures or the mix's own
    // error) used to be discarded here — the caller only saw hasAudio flip to
    // false with no explanation, so a real audio failure looked identical to
    // "no audio was authored" and shipped a silent video-only render.
    if (!hasAudio) audioError = audioResult.error ?? "audio mix failed for an unknown reason";
  }
  const audioProcessMs = Date.now() - stage3Start;

  return {
    audioOutputPath,
    hasAudio,
    audioProcessMs,
    audioError,
    audioFailures,
  };
}
