import { memo, useCallback, useMemo, useRef } from "react";
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
  rich: boolean;
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

function fakePeaks(url: string, count: number): number[] {
  let seed = 0;
  for (let index = 0; index < url.length; index++) {
    seed = ((seed << 5) - seed + url.charCodeAt(index)) | 0;
  }
  seed = Math.abs(seed) || 42;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed & 0x7fffffff) / 2147483647;
  };
  return Array.from({ length: count }, (_, index) => {
    const time = index / count;
    const envelope =
      0.3 + 0.3 * Math.sin(time * Math.PI * 3.2) + 0.2 * Math.sin(time * Math.PI * 7.1);
    return Math.max(0.05, Math.min(1, envelope * (0.4 + 0.6 * random())));
  });
}

async function loadWaveform(
  audioUrl: string,
  waveformUrl: string | undefined,
  signal: AbortSignal,
) {
  try {
    if (waveformUrl) {
      const response = await fetch(waveformUrl, { signal });
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
    const response = await fetch(audioUrl, { signal });
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
  } catch (error) {
    if (signal.aborted) throw error;
    return fakePeaks(waveformUrl ?? audioUrl, 4000);
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
    context.fillStyle = "rgba(75,163,210,0.78)";
    for (let index = 0; index < barCount; index++) {
      const peakIndex = start + Math.min(span - 1, Math.floor((index / barCount) * span));
      const amplitude = peaks[peakIndex] ?? 0;
      const barHeight = Math.max(2, amplitude * height);
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

  return (
    <div className="absolute inset-0 overflow-hidden">
      <canvas
        ref={setCanvasRef}
        className="absolute inset-x-0 bottom-0 w-full"
        style={{ top: 16 }}
      />
      {snapshot.status === "loading" && (
        <div className="absolute inset-x-0 bottom-0 top-4 animate-pulse bg-white/[0.035]" />
      )}
      {label && (
        <div className="absolute inset-x-0 top-0 z-10 px-1.5 py-0.5">
          <span
            className="block truncate text-[9px] font-semibold leading-tight"
            style={{ color: labelColor }}
          >
            {label}
          </span>
        </div>
      )}
    </div>
  );
});
