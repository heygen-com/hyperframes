import type { MediaProcessingJobState, StudioApiAdapter } from "../types.js";

export type BackgroundRemovalJobOptions = Parameters<
  NonNullable<StudioApiAdapter["startBackgroundRemoval"]>
>[0];

export type BackgroundRemovalProgressEvent =
  | { kind: "info"; message: string }
  | { kind: "metadata"; width: number; height: number; fps: number; frameCount: number }
  | { kind: "frame"; index: number; total: number; avgMsPerFrame: number };

export type BackgroundRemovalRender = (options: {
  inputPath: string;
  outputPath: string;
  backgroundOutputPath?: string;
  device?: BackgroundRemovalJobOptions["device"];
  quality?: BackgroundRemovalJobOptions["quality"];
  onProgress?: (event: BackgroundRemovalProgressEvent) => void;
}) => Promise<{
  provider: string;
  framesProcessed: number;
  durationSeconds: number;
  avgMsPerFrame: number;
}>;

export function createBackgroundRemovalJob(
  opts: BackgroundRemovalJobOptions,
  render: BackgroundRemovalRender,
): MediaProcessingJobState {
  const state: MediaProcessingJobState = {
    id: opts.jobId,
    status: "processing",
    progress: 0,
    stage: "Preparing background removal",
    inputAssetPath: opts.inputAssetPath,
    outputAssetPath: opts.outputAssetPath,
    outputPath: opts.outputPath,
    ...(opts.backgroundOutputPath ? { backgroundOutputPath: opts.backgroundOutputPath } : {}),
    ...(opts.backgroundOutputAssetPath
      ? { backgroundOutputAssetPath: opts.backgroundOutputAssetPath }
      : {}),
  };

  void (async () => {
    try {
      const result = await render({
        inputPath: opts.inputPath,
        outputPath: opts.outputPath,
        backgroundOutputPath: opts.backgroundOutputPath,
        device: opts.device,
        quality: opts.quality,
        onProgress: (event) => updateBackgroundRemovalProgress(state, event),
      });
      state.status = "complete";
      state.progress = 100;
      state.stage = "Complete";
      state.provider = result.provider;
      state.framesProcessed = result.framesProcessed;
      state.durationSeconds = result.durationSeconds;
      state.avgMsPerFrame = result.avgMsPerFrame;
    } catch (err) {
      state.status = "failed";
      state.error = err instanceof Error ? err.message : String(err);
      state.stage = "Failed";
    }
  })();

  return state;
}

function updateBackgroundRemovalProgress(
  state: MediaProcessingJobState,
  event: BackgroundRemovalProgressEvent,
): void {
  if (event.kind === "info") {
    state.stage = event.message;
    return;
  }
  if (event.kind === "metadata") {
    state.stage = `Source ${event.width}×${event.height}`;
    state.progress = 2;
    return;
  }
  state.progress = event.total ? Math.min(99, Math.floor((event.index / event.total) * 100)) : 0;
  state.stage = event.total
    ? `Removing background ${event.index}/${event.total}`
    : `Removing background frame ${event.index}`;
  state.framesProcessed = event.index;
  state.avgMsPerFrame = event.avgMsPerFrame;
}
