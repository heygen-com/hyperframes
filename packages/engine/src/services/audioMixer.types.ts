export interface AudioVolumeKeyframe {
  time: number;
  volume: number;
}

export interface AudioElement {
  id: string;
  src: string;
  start: number;
  end: number;
  mediaStart: number;
  /** Constant normalized source-time multiplier (0.1..5). */
  playbackRate?: number;
  layer: number;
  volume?: number;
  volumeKeyframes?: AudioVolumeKeyframe[];
  /** Serialised FX chain JSON from `data-fx-chain`, when set. */
  fxChain?: string;
  /** Serialised automation JSON from `data-automation`, when set. */
  automation?: string;
  /** The id of the `data-audio-group` this element is a member of, when set. */
  groupId?: string;
  /**
   * The group's own FX chain / automation / volume, duplicated identically
   * onto every member of the same group — all resolved from the one
   * `resolveAudioGroups` call `parseAudioElements` already makes, so a
   * render pass building a group sub-mix from a set of members has
   * everything it needs from any one of them without a second lookup.
   */
  groupFxChain?: string;
  groupAutomation?: string;
  groupVolume?: number;
  type: "audio" | "video";
}

export interface AudioTrack {
  id: string;
  srcPath: string;
  start: number;
  end: number;
  mediaStart: number;
  duration: number;
  volume: number;
  volumeKeyframes?: AudioVolumeKeyframe[];
  /**
   * Seconds of FX tail past `end` that the mix should let through — a reverb or
   * delay still decaying when the clip's own audio stops. Absent means cut at
   * the clip boundary, which is what every track without an FX chain wants.
   */
  tailSeconds?: number;
}

export type AudioFailureStage =
  | "source"
  | "download"
  | "probe"
  | "extract"
  | "prepare"
  | "mix"
  | "silence"
  | "cancelled"
  | "internal";

export type AudioFailureReason =
  | "source_not_found"
  | "download_failed"
  | "probe_failed"
  | "invalid_media"
  | "ffmpeg_unsupported"
  | "ffmpeg_timeout"
  | "ffmpeg_unavailable"
  | "ffmpeg_failed"
  | "cancelled"
  | "internal";

export interface AudioProcessingFailure {
  stage: AudioFailureStage;
  reason: AudioFailureReason;
  owner: "user" | "system";
  retryable: boolean;
  elementId?: string;
  /** Bounded diagnostic text; never includes the authored source URL/path. */
  detail: string;
}

export interface MixResult {
  success: boolean;
  outputPath: string;
  durationMs: number;
  tracksProcessed: number;
  error?: string;
  failures?: AudioProcessingFailure[];
}
