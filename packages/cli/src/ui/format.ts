import type { BrowserGpuMode } from "../browser/gpuPolicy.js";
import { c } from "./colors.js";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds - minutes * 60;
  return `${minutes}m ${remaining.toFixed(1)}s`;
}

/**
 * Build the detail portion of the render-complete summary (everything after the
 * file size). The output video length is shown as the primary figure, with the
 * wall-clock render time explicitly labeled "rendered in" so the two are never
 * confused (users were comparing the render time to ffprobe's media duration).
 * Directory (png-sequence) output has no single muxed video, so it shows a frame
 * count instead, or just the render time when neither is known. An HLS playlist
 * directory does play as one continuous video, so it reports a duration.
 */
export function formatRenderSummaryDetail(input: {
  elapsedMs: number;
  outputDurationSeconds?: number;
  isDirectory: boolean;
  frameCount?: number;
  playlistDirectory?: boolean;
}): string {
  const middle =
    input.isDirectory && !input.playlistDirectory
      ? input.frameCount != null
        ? `${input.frameCount} frames`
        : undefined
      : input.outputDurationSeconds != null && input.outputDurationSeconds > 0
        ? `${formatDuration(input.outputDurationSeconds * 1000)} video`
        : undefined;
  const renderTime = `rendered in ${formatDuration(input.elapsedMs)}`;
  return [middle, renderTime].filter(Boolean).join(" · ");
}

type PipelineStageKey =
  | "compileMs"
  | "videoExtractMs"
  | "audioProcessMs"
  | "browserProbeMs"
  | "captureSetupMs"
  | "captureFrameMs"
  | "encodeMs"
  | "assembleMs";

const PIPELINE_STAGES: ReadonlyArray<readonly [PipelineStageKey, string]> = [
  ["compileMs", "compile"],
  ["videoExtractMs", "extract"],
  ["audioProcessMs", "audio"],
  ["browserProbeMs", "probe"],
  ["captureSetupMs", "setup"],
  ["captureFrameMs", "capture"],
  ["encodeMs", "encode"],
  ["assembleMs", "assemble"],
];

/** Session mode wins unless it is the aggregator's empty `"unknown"` sentinel. */
export function resolvePrintedCaptureMode(
  sessionMode?: string,
  observabilityCaptureMode?: string,
): string | undefined {
  if (sessionMode && sessionMode !== "unknown") return sessionMode;
  return observabilityCaptureMode;
}

/** Capture path, gpu mode, and stage timings for the render summary. */
export function formatRenderPipelineDetail(input: {
  captureMode?: string;
  browserGpuMode?: BrowserGpuMode | string;
  streamingEncode?: boolean;
  stages: Record<string, number | undefined>;
}): string | undefined {
  const parts: string[] = [];
  if (input.captureMode) parts.push(`${input.captureMode} capture`);
  if (input.browserGpuMode) parts.push(`${input.browserGpuMode} gpu`);
  for (const [key, stageLabel] of PIPELINE_STAGES) {
    const ms = input.stages[key];
    if (ms == null) continue;
    const label =
      key === "encodeMs" && input.streamingEncode ? "encode (during capture)" : stageLabel;
    parts.push(`${label} ${formatDuration(ms)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/**
 * Why a Linux auto render stayed on screenshot after BeginFrame was requested.
 * Silent when software was requested (--docker, --no-browser-gpu) or off Linux.
 */
export function formatScreenshotFallbackHint(input: {
  captureMode?: string;
  browserGpuMode?: BrowserGpuMode | string;
  requestedGpuMode?: BrowserGpuMode;
  platform: NodeJS.Platform;
}): string | undefined {
  if (input.platform !== "linux" || input.requestedGpuMode !== "auto") return undefined;
  if (input.captureMode !== "screenshot" || input.browserGpuMode !== "software") return undefined;
  return (
    "Screenshot capture (slower): BeginFrame did not run. Needs chrome-headless-shell and no " +
    "--resolution upscale. Heavy compositions can stall on software GL."
  );
}

export function label(name: string, value: string): string {
  const pad = 14 - name.length;
  return `   ${c.dim(name)}${" ".repeat(Math.max(1, pad))}${c.bold(value)}`;
}

export function errorBox(title: string, hint?: string, suggestion?: string): void {
  console.error(`\n${c.error("\u2717")}  ${c.bold(title)}`);
  if (hint) {
    // Indent EVERY hint line, not just the first \u2014 a multi-line hint (e.g. the
    // NO_TOKEN numbered setup list) otherwise had line 1 indented and the rest
    // flush-left, mangling the list. Single-line hints are unchanged.
    const indented = hint
      .split("\n")
      .map((line) => `   ${line}`)
      .join("\n");
    console.error(`\n${c.dim(indented)}`);
  }
  if (suggestion) console.error(`   ${c.accent(suggestion)}`);
  console.error();
}
