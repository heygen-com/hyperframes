import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { useThumbnailLease } from "../../hooks/useThumbnailLease";
import { createThumbnailKey, type ThumbnailPriority } from "../lib/thumbnailScheduler";
import { decimatePeaks, loudnessToOpacity } from "./audioWaveformPeaks";

interface AudioWaveformProps {
  audioUrl: string;
  waveformUrl?: string;
  label: string;
  labelColor: string;
  trimStartFraction?: number;
  trimEndFraction?: number;
  projectId: string;
  sessionEpoch: number;
  priority: ThumbnailPriority;
  /** `data-hidden` or a muted audio group. Greys the pill; the clip stays. */
  muted?: boolean;
  /** Same media file as a video clip. Draws the 1px parent tick. */
  linked?: boolean;
}

const BAR_STEP = 3;

function extractPeaks(channelData: Float32Array, barCount: number): number[] {
  const peaks: number[] = [];
  const samplesPerBar = Math.floor(channelData.length / barCount);
  if (samplesPerBar === 0) return Array(barCount).fill(0);
  for (let index = 0; index < barCount; index++) {
    let max = 0;
    const start = index * samplesPerBar;
    const end = Math.min(start + samplesPerBar, channelData.length);
    for (let sample = start; sample < end; sample++) {
      max = Math.max(max, Math.abs(channelData[sample] ?? 0));
    }
    peaks.push(max);
  }
  const maxPeak = Math.max(...peaks, 0.001);
  return peaks.map((peak) => peak / maxPeak);
}

async function loadWaveform(
  audioUrl: string,
  waveformUrl: string | undefined,
  signal: AbortSignal,
): Promise<number[]> {
  // Failures propagate. Synthesised peaks are worse than an honest gap: an
  // author trims and beat-aligns against this waveform, and a plausible
  // fabrication is indistinguishable from the real thing while being wrong.
  // The scheduler caches the failure (metadataFailureTtlMs) so the degraded
  // state neither refetch-loops nor pins itself past a transient error.
  return waveformUrl
    ? await fetchWaveformPeaks(waveformUrl, signal)
    : await decodeWaveformPeaks(audioUrl, signal);
}

async function fetchWaveformPeaks(url: string, signal: AbortSignal): Promise<number[]> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Waveform request failed (${response.status})`);
  const data: unknown = await response.json();
  if (
    typeof data !== "object" ||
    data === null ||
    !("peaks" in data) ||
    !Array.isArray(data.peaks) ||
    !data.peaks.every((peak) => typeof peak === "number")
  ) {
    throw new Error("Invalid waveform response");
  }
  return data.peaks;
}

async function decodeWaveformPeaks(url: string, signal: AbortSignal): Promise<number[]> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Audio request failed (${response.status})`);
  const buffer = await response.arrayBuffer();
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(buffer);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    return extractPeaks(decoded.getChannelData(0), 4000);
  } finally {
    await context.close();
  }
}

/** Bounded waveform subscriber; cache, cancellation and dedupe live in one scheduler. */
export const AudioWaveform = memo(function AudioWaveform({
  audioUrl,
  waveformUrl,
  label,
  labelColor,
  trimStartFraction,
  trimEndFraction,
  projectId,
  sessionEpoch,
  priority,
  muted = false,
  linked = false,
}: AudioWaveformProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const cacheKey = waveformUrl ?? audioUrl;
  const request = useMemo(
    () => ({
      key: createThumbnailKey({ kind: "waveform", source: cacheKey }),
      projectId,
      sessionEpoch,
      kind: "waveform" as const,
      priority,
      rich: false,
      load: async (signal: AbortSignal) => {
        const peaks = await loadWaveform(audioUrl, waveformUrl, signal);
        return {
          value: { kind: "waveform" as const, peaks },
          weight: peaks.length * Float64Array.BYTES_PER_ELEMENT,
        };
      },
    }),
    [audioUrl, cacheKey, priority, projectId, sessionEpoch, waveformUrl],
  );
  const snapshot = useThumbnailLease(cacheKey ? request : null);
  const peaks =
    snapshot.status === "ready" && snapshot.value.kind === "waveform" ? snapshot.value.peaks : null;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(scale, scale);
    context.clearRect(0, 0, width, height);
    const barCount = Math.max(1, Math.ceil(width / BAR_STEP));
    const bars = decimatePeaks(peaks, trimStartFraction ?? 0, trimEndFraction ?? 1, barCount);
    const channelToken = muted ? "--timeline-waveform-muted-rgb" : "--timeline-waveform-bar-rgb";
    const waveformBarRgb = getComputedStyle(canvas).getPropertyValue(channelToken);
    const waveformBaselineRgb = getComputedStyle(canvas).getPropertyValue(
      "--timeline-waveform-baseline-rgb",
    );
    for (let index = 0; index < bars.length; index++) {
      const amplitude = bars[index] ?? 0;
      const barHeight = Math.max(3, amplitude * height);
      // Map each decimated bar to the full canvas interval. Fixed pixel
      // offsets leave a visible tail gap when the clip width is fractional.
      const x = (index * width) / bars.length;
      const barWidth = Math.max(1, width / bars.length);
      context.fillStyle = `rgb(${waveformBaselineRgb})`;
      context.fillRect(x, height - 2, barWidth, 2);
      context.fillStyle = `rgba(${waveformBarRgb},${loudnessToOpacity(amplitude).toFixed(2)})`;
      context.fillRect(x, height - barHeight, barWidth, barHeight);
    }
  }, [muted, peaks, trimEndFraction, trimStartFraction]);

  const setCanvasRef = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      observerRef.current?.disconnect();
      canvasRef.current = canvas;
      if (!canvas) return;
      draw();
      observerRef.current = new ResizeObserver(draw);
      observerRef.current.observe(canvas);
    },
    [draw],
  );

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(draw);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class", "data-chrome", "data-theme", "style"],
    });
    return () => observer.disconnect();
  }, [draw]);

  useMountEffect(() => () => observerRef.current?.disconnect());

  useEffect(() => {
    const clip = rootRef.current?.closest(".timeline-clip");
    if (!(clip instanceof HTMLElement)) return;
    if (muted) clip.setAttribute("data-audio-muted", "true");
    else clip.removeAttribute("data-audio-muted");
    return () => clip.removeAttribute("data-audio-muted");
  }, [muted]);

  return (
    <div ref={rootRef} className="absolute inset-0">
      {linked ? <span className="timeline-audio-link" aria-hidden="true" /> : null}
      <div className="absolute inset-0 z-[6] overflow-hidden">
        <canvas
          ref={setCanvasRef}
          className="absolute inset-x-0 bottom-0 w-full"
          style={{ top: 16 }}
        />
        {snapshot.status === "loading" && (
          <div
            className="absolute inset-x-0 bottom-0 top-4 animate-pulse"
            style={{
              background: "var(--timeline-thumbnail-shimmer)",
            }}
          />
        )}
        {/* Degraded state — the decode failed; say so rather than paint a
          waveform the author could edit against. */}
        {snapshot.status === "error" && (
          <div
            className="absolute inset-x-0 flex items-center justify-center gap-1.5"
            style={{ top: 16, bottom: 0 }}
          >
            <div
              className="absolute inset-x-0"
              style={{
                bottom: "20%",
                height: 2,
                background: "var(--timeline-waveform-error)",
              }}
            />
            <span className="relative rounded-sm bg-black/50 px-1 text-[8px] text-neutral-500">
              waveform unavailable
            </span>
          </div>
        )}
        {label && (
          <div className="absolute inset-x-0 top-0 z-10 px-1.5 py-0.5">
            <span
              className="block truncate text-[9px] font-semibold leading-tight"
              style={{ color: labelColor, textShadow: "var(--timeline-waveform-label-shadow)" }}
            >
              {label}
            </span>
          </div>
        )}
      </div>
    </div>
  );
});
