import { memo, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { fadeGain } from "@hyperframes/core/audio-fade";
import { useMountEffect } from "../../hooks/useMountEffect";
import { useThumbnailLease } from "../../hooks/useThumbnailLease";
import { createThumbnailKey, type ThumbnailPriority } from "../lib/thumbnailScheduler";
import { decimatePeaks, loudnessToOpacity } from "./audioWaveformPeaks";
import { ClipFadesContext, type ClipFadeShape } from "./TimelineClipFades";
import { isTimelineMoving, subscribeTimelineMotion } from "./timelineMotion";
import { studioApiFetch } from "../../utils/studioApiFetch";

export interface AudioWaveformProps {
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
  labelInset?: number;
}

const BAR_STEP = 3;

export const rendersWaveform = (el: { tag: string }) => el.tag === "audio";
const FADE_GHOST_OPACITY = 0.27;
export const WAVEFORM_LAYER_Z = 10;

type BarGeometry = { x: number; width: number; height: number; gain: number };

/** A stretch of the clip as fractions of its width. */
export type ClipSpan = { from: number; to: number };
const WHOLE_CLIP: ClipSpan = { from: 0, to: 1 };
// Drawn past the viewport by this many widths each side, so a short scroll shows bars already drawn.
const OVERSCAN_VIEWPORTS = 1;

/** The part of the clip on screen, with overscan; a long clip never draws past it. */
function visibleClipSpan(root: HTMLElement, overscan = OVERSCAN_VIEWPORTS): ClipSpan {
  const box = root.getBoundingClientRect();
  if (box.width <= 0) return WHOLE_CLIP;
  const scroller = root.closest("[data-timeline-scroll-viewport]");
  const view = scroller?.getBoundingClientRect() ?? { left: 0, right: window.innerWidth };
  const margin = (view.right - view.left) * overscan;
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const from = clamp((view.left - margin - box.left) / box.width);
  const to = clamp((view.right + margin - box.left) / box.width);
  return { from, to: Math.max(from, to) };
}

function paintWaveformBars(
  context: CanvasRenderingContext2D,
  bars: readonly BarGeometry[],
  height: number,
  waveformBarRgb: string,
  waveformBaselineRgb: string,
  amplitudes: readonly number[],
) {
  bars.forEach((bar, index) => {
    const opacity = loudnessToOpacity(amplitudes[index] ?? 0);
    context.fillStyle = `rgb(${waveformBaselineRgb})`;
    context.fillRect(bar.x, height - 2, bar.width, 2);
    const paint = (alpha: number, top: number, barHeight: number) => {
      context.fillStyle = `rgba(${waveformBarRgb},${alpha.toFixed(2)})`;
      context.fillRect(bar.x, top, bar.width, barHeight);
    };
    const faded = bar.height * bar.gain;
    if (faded > 0) paint(opacity, height - faded, faded);
    if (faded < bar.height) {
      paint(opacity * FADE_GHOST_OPACITY, height - bar.height, bar.height - faded);
    }
  });
}

export function drawWaveformCanvas(
  canvas: HTMLCanvasElement,
  peaks: readonly number[],
  muted: boolean,
  trimStartFraction: number,
  trimEndFraction: number,
  fades: ClipFadeShape | null = null,
  span: ClipSpan = WHOLE_CLIP,
) {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.scale(scale, scale);
  context.clearRect(0, 0, width, height);
  const trim = trimEndFraction - trimStartFraction;
  const amplitudes = decimatePeaks(
    peaks,
    trimStartFraction + trim * span.from,
    trimStartFraction + trim * span.to,
    Math.max(1, Math.ceil(width / BAR_STEP)),
  );
  const clipFraction = (index: number) =>
    span.from + ((index + 0.5) / amplitudes.length) * (span.to - span.from);
  const bars = amplitudes.map((amplitude, index) => ({
    x: (index * width) / amplitudes.length,
    width: Math.max(1, width / amplitudes.length),
    height: Math.max(3, amplitude * height),
    gain: fades ? fadeGain(clipFraction(index) * fades.duration, fades.duration, fades) : 1,
  }));
  const channelToken = muted ? "--timeline-waveform-muted-rgb" : "--timeline-waveform-bar-rgb";
  const waveformBarRgb = getComputedStyle(canvas).getPropertyValue(channelToken);
  const waveformBaselineRgb = getComputedStyle(canvas).getPropertyValue(
    "--timeline-waveform-baseline-rgb",
  );
  paintWaveformBars(context, bars, height, waveformBarRgb, waveformBaselineRgb, amplitudes);
}

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
  const response = await studioApiFetch(url, { signal });
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
  const response = await studioApiFetch(url, { signal });
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
  labelInset = 16,
}: AudioWaveformProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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

  const fades = useContext(ClipFadesContext);
  const drawnSpan = useRef<ClipSpan | null>(null);
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root || !peaks) return;
    const span = visibleClipSpan(root);
    drawnSpan.current = span;
    // Placed in fractions of the clip, so a zoom stretches the drawn bars with time until the redraw.
    canvas.style.left = `${span.from * 100}%`;
    canvas.style.width = `${(span.to - span.from) * 100}%`;
    if (span.to <= span.from) return;
    drawWaveformCanvas(
      canvas,
      peaks,
      muted,
      trimStartFraction ?? 0,
      trimEndFraction ?? 1,
      fades,
      span,
    );
  }, [fades, muted, peaks, trimEndFraction, trimStartFraction]);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(draw, [draw]);

  // Redrawn when the clip resizes or a zoom comes to rest, never per zoom step: a step only
  // stretches what is drawn. A scroll redraws only once the view leaves the drawn stretch.
  useMountEffect(() => {
    const root = rootRef.current;
    const redrawAtRest = () => {
      if (!isTimelineMoving()) drawRef.current();
    };
    const redrawIfUncovered = () => {
      const drawn = drawnSpan.current;
      if (!root || !drawn || isTimelineMoving()) return;
      const seen = visibleClipSpan(root, 0);
      if (seen.from < drawn.from || seen.to > drawn.to) drawRef.current();
    };
    const observer = root ? new ResizeObserver(redrawAtRest) : null;
    if (root) observer?.observe(root);
    const scroller = root?.closest("[data-timeline-scroll-viewport]");
    scroller?.addEventListener("scroll", redrawIfUncovered, { passive: true });
    const unsubscribe = subscribeTimelineMotion(redrawAtRest);
    return () => {
      observer?.disconnect();
      scroller?.removeEventListener("scroll", redrawIfUncovered);
      unsubscribe();
    };
  });

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(draw);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class", "data-chrome", "data-theme", "style"],
    });
    return () => observer.disconnect();
  }, [draw]);

  useEffect(() => {
    const clip = rootRef.current?.closest(".timeline-clip");
    if (!(clip instanceof HTMLElement)) return;
    if (muted) clip.setAttribute("data-audio-muted", "true");
    else clip.removeAttribute("data-audio-muted");
    return () => clip.removeAttribute("data-audio-muted");
  }, [muted]);

  return (
    <div ref={rootRef} className="absolute inset-0">
      <div className="absolute inset-0 overflow-hidden" style={{ zIndex: WAVEFORM_LAYER_Z }}>
        <canvas
          ref={canvasRef}
          className="absolute bottom-0"
          style={{
            left: 0,
            width: "100%",
            top: labelInset,
            height: `calc(100% - ${labelInset}px)`,
          }}
        />
        {snapshot.status === "loading" && (
          <div
            className="absolute inset-x-0 bottom-0 animate-pulse"
            style={{
              top: labelInset,
              background: "var(--timeline-thumbnail-shimmer)",
            }}
          />
        )}
        {/* Degraded state — the decode failed; say so rather than paint a
          waveform the author could edit against. */}
        {snapshot.status === "error" && (
          <div
            className="absolute inset-x-0 flex items-center justify-center gap-1.5"
            style={{ top: labelInset, bottom: 0 }}
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
