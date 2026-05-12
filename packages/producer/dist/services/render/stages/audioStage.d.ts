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
}
export declare function runAudioStage(input: AudioStageInput): Promise<AudioStageResult>;
//# sourceMappingURL=audioStage.d.ts.map