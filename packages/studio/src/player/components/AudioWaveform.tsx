import { memo, useRef, useState, useCallback, useEffect, useMemo } from "react";
import { decodeAudioFromUrl, mediaCacheKey, waveformResolver } from "../lib/mediaResolver";

interface AudioWaveformProps {
  audioUrl: string;
  waveformUrl?: string;
  label: string;
  labelColor: string;
  /**
   * Fraction (0–1) of the source the clip starts at, after the media-start
   * trim. Defaults to 0 (no front trim).
   */
  trimStartFraction?: number;
  /**
   * Fraction (0–1) of the source the clip ends at. Defaults to 1 (no tail
   * trim). Together these window the rendered peaks to the trimmed slice so the
   * waveform tracks the clip edges instead of squeezing the whole file in.
   */
  trimEndFraction?: number;
}

const BAR_W = 2;
const GAP = 1;
const STEP = BAR_W + GAP;

/** Downsample PCM channel data into peak amplitudes (0–1). */
function extractPeaks(channelData: Float32Array, barCount: number): number[] {
  const peaks: number[] = [];
  const samplesPerBar = Math.floor(channelData.length / barCount);
  if (samplesPerBar === 0) return Array(barCount).fill(0);
  for (let i = 0; i < barCount; i++) {
    let max = 0;
    const start = i * samplesPerBar;
    const end = Math.min(start + samplesPerBar, channelData.length);
    for (let j = start; j < end; j++) {
      // fallow-ignore-next-line code-duplication
      const abs = Math.abs(channelData[j] ?? 0);
      if (abs > max) max = abs;
    }
    peaks.push(max);
  }
  const maxPeak = Math.max(...peaks, 0.001);
  return peaks.map((p) => p / maxPeak);
}

/** Deterministic fake waveform as fallback (matches demo app). */
function fakePeaks(url: string, count: number): number[] {
  let seed = 0;
  for (let i = 0; i < url.length; i++) seed = ((seed << 5) - seed + url.charCodeAt(i)) | 0;
  seed = Math.abs(seed) || 42;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed & 0x7fffffff) / 2147483647;
  };
  const peaks: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const envelope = 0.3 + 0.3 * Math.sin(t * Math.PI * 3.2) + 0.2 * Math.sin(t * Math.PI * 7.1);
    peaks.push(Math.max(0.05, Math.min(1, envelope * (0.4 + 0.6 * rand()))));
  }
  return peaks;
}

const PEAK_COUNT = 4000;

/**
 * Fetch + decode one source into peaks. Never rejects: a failed decode falls
 * back to the deterministic fake pattern, which is a legitimate result worth
 * caching rather than a failure worth retrying.
 */
async function decodeWaveformPeaks(
  audioUrl: string,
  waveformUrl: string | undefined,
  seed: string,
): Promise<number[]> {
  try {
    if (waveformUrl) {
      const data: { peaks?: number[] } = await fetch(waveformUrl).then((r) => r.json());
      if (!Array.isArray(data.peaks)) throw new Error("bad response");
      return data.peaks;
    }
    const decoded = await decodeAudioFromUrl(audioUrl);
    return extractPeaks(decoded.getChannelData(0), PEAK_COUNT);
  } catch {
    return fakePeaks(seed, PEAK_COUNT);
  }
}

/**
 * Audio waveform rendered from real PCM data via Web Audio API.
 * Falls back to a deterministic fake pattern if decoding fails.
 * Bars grow from bottom to top, rendered as CSS divs for zoom resilience.
 */
export const AudioWaveform = memo(function AudioWaveform({
  audioUrl,
  waveformUrl,
  label,
  labelColor,
  trimStartFraction,
  trimEndFraction,
}: AudioWaveformProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const barsRef = useRef<HTMLDivElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const source = waveformUrl ?? audioUrl;
  const cacheKey = useMemo(() => (source ? mediaCacheKey(source) : ""), [source]);
  const [peaks, setPeaks] = useState<number[] | null>(
    () => (cacheKey ? waveformResolver.peek(cacheKey) : undefined) ?? null,
  );

  useEffect(() => {
    if (peaks || !cacheKey) return;
    let cancelled = false;
    waveformResolver
      .resolve(cacheKey, () => decodeWaveformPeaks(audioUrl, waveformUrl, cacheKey))
      .then((p) => {
        if (!cancelled) setPeaks(p);
      });
    return () => {
      cancelled = true;
    };
  }, [audioUrl, waveformUrl, cacheKey, peaks]);

  // Draw bars into the container using innerHTML (fast, zoom-resilient)
  const draw = useCallback(() => {
    const container = containerRef.current;
    const barsEl = barsRef.current;
    if (!container || !barsEl || !peaks) return;

    // Window the peaks to the trimmed slice [start, end) of the source so the
    // bars track the clip edges. Clamp to a valid, non-empty range.
    const winStart = Math.max(0, Math.min(1, trimStartFraction ?? 0));
    const winEnd = Math.max(winStart, Math.min(1, trimEndFraction ?? 1));
    const lo = Math.floor(winStart * peaks.length);
    const hi = Math.max(lo + 1, Math.ceil(winEnd * peaks.length));
    const span = hi - lo;

    // Fill the full (possibly zoomed) clip width with STEP-spaced bars, resampling
    // the windowed peaks across them — upsampling (repeating peaks) when the clip
    // is wider than the slice has samples, so the waveform stretches with zoom
    // instead of stopping partway across.
    const w = container.clientWidth || 400;
    const barCount = Math.max(0, Math.floor(w / STEP));

    let html = "";
    for (let i = 0; i < barCount; i++) {
      // Map bar index to peak index within the windowed range (resample)
      const peakIdx = lo + Math.min(span - 1, Math.floor((i / barCount) * span));
      const amp = peaks[peakIdx] ?? 0;
      const pct = Math.max(3, Math.round(amp * 100));
      const opacity = (0.45 + amp * 0.4).toFixed(2);
      html += `<div style="position:absolute;bottom:0;left:${i * STEP}px;width:${BAR_W}px;height:${pct}%;background:rgba(75,163,210,${opacity})"></div>`;
    }
    barsEl.innerHTML = html;
  }, [peaks, trimStartFraction, trimEndFraction]);

  // Observe container size and redraw
  const setContainerRef = useCallback(
    (el: HTMLDivElement | null) => {
      roRef.current?.disconnect();
      containerRef.current = el;
      if (!el) return;
      draw();
      roRef.current = new ResizeObserver(() => draw());
      roRef.current.observe(el);
    },
    [draw],
  );

  // Redraw when peaks arrive
  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(
    () => () => {
      roRef.current?.disconnect();
    },
    [],
  );

  return (
    <div ref={setContainerRef} className="absolute inset-0 overflow-hidden">
      <div ref={barsRef} className="absolute left-0 right-0 bottom-0" style={{ top: 16 }} />
      {/* Shimmer while decoding */}
      {!peaks && (
        <div
          className="absolute left-0 right-0 bottom-0 animate-pulse"
          style={{
            top: 16,
            background:
              "linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.02) 100%)",
          }}
        />
      )}
      {label && (
        <div className="absolute top-0 left-0 right-0 px-1.5 py-0.5 z-10">
          <span
            className="text-[9px] font-semibold truncate block leading-tight"
            style={{ color: labelColor, textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}
          >
            {label}
          </span>
        </div>
      )}
    </div>
  );
});
