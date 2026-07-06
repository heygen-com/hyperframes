import { memo, useRef, useState, useCallback, useEffect } from "react";

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
      const abs = Math.abs(channelData[j] ?? 0);
      if (abs > max) max = abs;
    }
    peaks.push(max);
  }
  const maxPeak = Math.max(...peaks, 0.001);
  return peaks.map((p) => p / maxPeak);
}

// Module-level cache so decoded audio persists across re-renders and re-mounts
const peaksCache = new Map<string, number[]>();
const decodeInFlight = new Map<string, Promise<number[] | null>>();
// URLs whose fetch/decode recently failed — render the degraded state instead
// of refetch-looping (and never fabricate plausible-looking peaks the user
// might trim or beat-align against). Failures expire so a transient error
// (server restarting, file mid-import) doesn't pin "unavailable" all session.
const decodeFailed = new Map<string, number>();
const DECODE_RETRY_MS = 30_000;
function hasRecentDecodeFailure(key: string): boolean {
  const failedAt = decodeFailed.get(key);
  if (failedAt === undefined) return false;
  if (Date.now() - failedAt > DECODE_RETRY_MS) {
    decodeFailed.delete(key);
    return false;
  }
  return true;
}

/**
 * Audio waveform rendered from real PCM data via Web Audio API.
 * Shows an explicit "waveform unavailable" degraded state if decoding fails.
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
  const cacheKey = waveformUrl ?? audioUrl;
  const [peaks, setPeaks] = useState<number[] | null>(peaksCache.get(cacheKey) ?? null);
  const [decodeError, setDecodeError] = useState(() => hasRecentDecodeFailure(cacheKey));

  // Re-sync when the clip's audio source is swapped on the same mounted
  // component — a stale error (or stale peaks) must not block the new URL.
  useEffect(() => {
    setPeaks(peaksCache.get(cacheKey) ?? null);
    setDecodeError(hasRecentDecodeFailure(cacheKey));
  }, [cacheKey]);

  useEffect(() => {
    if (peaks || decodeError || !cacheKey) return;

    let cancelled = false;

    let promise = decodeInFlight.get(cacheKey);
    if (!promise) {
      promise = (
        waveformUrl
          ? fetch(waveformUrl)
              .then((r) => r.json())
              .then((d: { peaks?: number[] }) => {
                if (!Array.isArray(d.peaks)) throw new Error("bad response");
                return d.peaks;
              })
          : fetch(audioUrl)
              .then((r) => r.arrayBuffer())
              .then((buf) => {
                const ctx = new AudioContext();
                return ctx.decodeAudioData(buf).finally(() => ctx.close());
              })
              .then((decoded) => extractPeaks(decoded.getChannelData(0), 4000))
      )
        .then((p: number[]) => {
          peaksCache.set(cacheKey, p);
          return p as number[] | null;
        })
        .catch(() => {
          decodeFailed.set(cacheKey, Date.now());
          return null;
        })
        .finally(() => decodeInFlight.delete(cacheKey));

      decodeInFlight.set(cacheKey, promise);
    }

    promise.then((p) => {
      if (cancelled) return;
      if (p) setPeaks(p);
      else setDecodeError(true);
    });
    return () => {
      cancelled = true;
    };
  }, [audioUrl, waveformUrl, cacheKey, peaks, decodeError]);

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
      {!peaks && !decodeError && (
        <div
          className="absolute left-0 right-0 bottom-0 animate-pulse motion-reduce:animate-none"
          style={{
            top: 16,
            background:
              "linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.02) 100%)",
          }}
        />
      )}
      {/* Degraded state — decode failed; render an explicit flat placeholder
          instead of fabricated peaks the user might edit against. */}
      {decodeError && (
        <div
          className="absolute left-0 right-0 flex items-center justify-center gap-1.5"
          style={{ top: 16, bottom: 0 }}
        >
          <div
            className="absolute left-0 right-0"
            style={{
              bottom: "20%",
              height: 2,
              background:
                "repeating-linear-gradient(90deg, rgba(75,163,210,0.35) 0 2px, transparent 2px 5px)",
            }}
          />
          <span className="relative text-[8px] text-neutral-500 bg-black/50 px-1 rounded">
            waveform unavailable
          </span>
        </div>
      )}
      <div className="absolute top-0 left-0 right-0 px-1.5 py-0.5 z-10">
        <span
          className="text-[9px] font-semibold truncate block leading-tight"
          style={{ color: labelColor, textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}
        >
          {label}
        </span>
      </div>
    </div>
  );
});
