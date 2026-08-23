import { memo, useCallback, useMemo, useRef } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { useThumbnailLease } from "../../hooks/useThumbnailLease";
import { createThumbnailKey, type ThumbnailPriority } from "../lib/thumbnailScheduler";

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
}

const BAR_WIDTH = 2;
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
}: AudioWaveformProps) {
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
    const startFraction = Math.max(0, Math.min(1, trimStartFraction ?? 0));
    const endFraction = Math.max(startFraction, Math.min(1, trimEndFraction ?? 1));
    const start = Math.floor(startFraction * peaks.length);
    const end = Math.max(start + 1, Math.ceil(endFraction * peaks.length));
    const span = end - start;
    const barCount = Math.floor(width / BAR_STEP);
    for (let index = 0; index < barCount; index++) {
      const peakIndex = start + Math.min(span - 1, Math.floor((index / barCount) * span));
      const amplitude = peaks[peakIndex] ?? 0;
      const barHeight = Math.max(2, amplitude * height);
      context.fillStyle = `rgba(75,163,210,${(0.45 + amplitude * 0.4).toFixed(2)})`;
      context.fillRect(index * BAR_STEP, height - barHeight, BAR_WIDTH, barHeight);
    }
  }, [peaks, trimEndFraction, trimStartFraction]);

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

  useMountEffect(() => () => observerRef.current?.disconnect());

  return (
    <div className="absolute inset-0 overflow-hidden">
      <canvas
        ref={setCanvasRef}
        className="absolute inset-x-0 bottom-0 w-full"
        style={{ top: 16 }}
      />
      {snapshot.status === "loading" && (
        <div
          className="absolute inset-x-0 bottom-0 top-4 animate-pulse"
          style={{
            background:
              "linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.02) 100%)",
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
              background:
                "repeating-linear-gradient(90deg, rgba(75,163,210,0.35) 0 2px, transparent 2px 5px)",
            }}
          />
          <span className="relative rounded bg-black/50 px-1 text-[8px] text-neutral-500">
            waveform unavailable
          </span>
        </div>
      )}
      {label && (
        <div className="absolute inset-x-0 top-0 z-10 px-1.5 py-0.5">
          <span
            className="block truncate text-[9px] font-semibold leading-tight"
            style={{ color: labelColor, textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}
          >
            {label}
          </span>
        </div>
      )}
    </div>
  );
});
