/**
 * For HyperFrames' own apps; it may change between minor versions. Nothing here prints, reads
 * argv or exits. Known failures throw TranscribeError or RemoveBackgroundError with a `code`.
 */
import { runTranscribe, type TranscribeOptions, type TranscribeResult } from "./api/transcribe.js";

export {
  MIN_TIMEOUT_MS,
  TranscribeError,
  type CaptionFormat,
  type TranscribeCaptionsOptions,
  type TranscribeEngine,
  type TranscribeEngineEvent,
  type TranscribeErrorCode,
  type TranscribeOptions,
  type TranscribeProgressEvent,
  type TranscribeResult,
  type TranscribeRunner,
  type TranscriptFormat,
} from "./api/transcribe.js";
export {
  RemoveBackgroundError,
  removeBackground,
  type RemoveBackgroundDevice,
  type RemoveBackgroundErrorCode,
  type RemoveBackgroundOptions,
  type RemoveBackgroundProgress,
  type RemoveBackgroundQuality,
  type RemoveBackgroundResult,
} from "./api/removeBackground.js";

export {
  offloadHeavyMedia,
  type GifPrep,
  type OffloadOptions,
  type OffloadedMedia,
  type Reencoder,
  type UploadableFile,
} from "./cloud/offload.js";
export type { DiskFile, StagedFile } from "./utils/publishProject.js";

/** Transcribe media to `dir`/transcript.json, or import or export a transcript file. */
export function transcribe(options: TranscribeOptions): Promise<TranscribeResult> {
  return runTranscribe(options);
}
