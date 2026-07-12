/**
 * audioStage — mix the composition's audio tracks into `workDir/audio.aac`.
 *
 * Trivial wrapper around `processCompositionAudio`. The stage is skipped
 * (no ffmpeg invocation) when the composition has no audio elements; the
 * timer is still set so the perf summary stays consistent across renders.
 *
 * Hard constraints preserved verbatim:
 *   - `audioOutputPath` is always `join(workDir, "audio.aac")`, regardless
 *     of whether any audio was actually produced.
 *   - `hasAudio` reflects `audioResult.success` from
 *     `processCompositionAudio`; it is `false` when there are no audio
 *     elements (skips the call entirely) and also when the call returns
 *     `success: false`.
 *   - `perfStages.audioProcessMs` is set whether or not the call ran.
 */

import { join } from "node:path";
import { processCompositionAudio } from "@hyperframes/engine";
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
  /** Always `join(workDir, "audio.aac")`. */
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
}

export async function runAudioStage(input: AudioStageInput): Promise<AudioStageResult> {
  const { projectDir, workDir, compiledDir, duration, audios, abortSignal, assertNotAborted } =
    input;

  const stage3Start = Date.now();
  const audioOutputPath = join(workDir, "audio.aac");
  let hasAudio = false;
  let audioError: string | undefined;

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
    // processCompositionAudio's error (per-element failures or the mix's own
    // error) used to be discarded here — the caller only saw hasAudio flip to
    // false with no explanation, so a real audio failure looked identical to
    // "no audio was authored" and shipped a silent video-only render.
    if (!hasAudio) audioError = audioResult.error ?? "audio mix failed for an unknown reason";
  }
  const audioProcessMs = Date.now() - stage3Start;

  return { audioOutputPath, hasAudio, audioProcessMs, audioError };
}
