export type ExportFormat = "mp4" | "webm";

export interface ExportProgress {
  phase: "audio" | "video" | "finalize";
  renderedFrames: number;
  totalFrames: number;
  /** Overall completion in [0, 1]. */
  fraction: number;
}

export interface ExportOptions {
  /** Frames per second of the output video. Defaults to 30. */
  fps?: number;
  /** Container/codec pair: mp4 (H.264 + AAC) or webm (VP9 + Opus). Defaults to mp4. */
  format?: ExportFormat;
  /**
   * Duration override in seconds. When omitted, the duration is read from the
   * composition's master GSAP timeline in window.__timelines.
   */
  duration?: number;
  /** Video bitrate in bits/s. Defaults to mediabunny's QUALITY_HIGH. */
  videoBitrate?: number;
  /** Audio bitrate in bits/s. Defaults to mediabunny's QUALITY_HIGH. */
  audioBitrate?: number;
  /** Set to false to skip audio decoding/mixing entirely. Defaults to true. */
  includeAudio?: boolean;
  /** Rasterization scale factor (2 = supersampled capture). Defaults to 1. */
  pixelRatio?: number;
  /** Forced key frame cadence in seconds. Defaults to 2. */
  keyFrameIntervalSeconds?: number;
  /** Abort the export between frames. */
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void;
}

export interface ExportResult {
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  frameCount: number;
  compositionId: string | null;
}
