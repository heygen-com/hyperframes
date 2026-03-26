import { useRef, useMemo, useCallback, useState, memo, type ReactNode, useEffect } from "react";
import { usePlayerStore, liveTime } from "../store/playerStore";
import { useMountEffect } from "../lib/useMountEffect";
import { TimelineClip } from "./TimelineClip";

/* ── Layout ─────────────────────────────────────────────────────── */
const GUTTER = 32;
const TRACK_H = 72;
const RULER_H = 24;
const CLIP_Y = 3; // vertical inset inside track

/* ── Vibrant Color System (Figma-inspired, dark-mode adapted) ──── */
interface TrackStyle {
  /** Clip solid background */
  clip: string;
  /** Dark text color for label on clip */
  label: string;
  /** Track row tint (very subtle) */
  row: string;
  /** Gutter icon circle background */
  gutter: string;
  /** SVG icon paths (viewBox 0 0 24 24) */
  icon: ReactNode;
}

/* ── Icons from Figma Motion Cut design system ── */
const ICON_BASE = "/icons/timeline";
function TimelineIcon({ src }: { src: string }) {
  return (
    <img
      src={src}
      alt=""
      width={12}
      height={12}
      style={{ filter: "brightness(0) invert(1)" }}
      draggable={false}
    />
  );
}
const IconCaptions = <TimelineIcon src={`${ICON_BASE}/captions.svg`} />;
const IconImage = <TimelineIcon src={`${ICON_BASE}/image.svg`} />;
const IconMusic = <TimelineIcon src={`${ICON_BASE}/music.svg`} />;
const IconText = <TimelineIcon src={`${ICON_BASE}/text.svg`} />;
const IconComposition = <TimelineIcon src={`${ICON_BASE}/composition.svg`} />;
const IconAudio = <TimelineIcon src={`${ICON_BASE}/audio.svg`} />;

const STYLES: Record<string, TrackStyle> = {
  video: {
    clip: "#1F6AFF",
    label: "#DBEAFE",
    row: "rgba(31,106,255,0.04)",
    gutter: "#1F6AFF",
    icon: IconImage,
  },
  audio: {
    clip: "#00C4FF",
    label: "#013A4B",
    row: "rgba(0,196,255,0.04)",
    gutter: "#00C4FF",
    icon: IconMusic,
  },
  img: {
    clip: "#8B5CF6",
    label: "#EDE9FE",
    row: "rgba(139,92,246,0.04)",
    gutter: "#8B5CF6",
    icon: IconImage,
  },
  div: {
    clip: "#68B200",
    label: "#1A2B03",
    row: "rgba(104,178,0,0.04)",
    gutter: "#68B200",
    icon: IconComposition,
  },
  span: {
    clip: "#F3A6FF",
    label: "#8D00A3",
    row: "rgba(243,166,255,0.04)",
    gutter: "#F3A6FF",
    icon: IconCaptions,
  },
  p: {
    clip: "#35C838",
    label: "#024A03",
    row: "rgba(53,200,56,0.04)",
    gutter: "#35C838",
    icon: IconText,
  },
  h1: {
    clip: "#35C838",
    label: "#024A03",
    row: "rgba(53,200,56,0.04)",
    gutter: "#35C838",
    icon: IconText,
  },
  section: {
    clip: "#68B200",
    label: "#1A2B03",
    row: "rgba(104,178,0,0.04)",
    gutter: "#68B200",
    icon: IconComposition,
  },
  sfx: {
    clip: "#FF8C42",
    label: "#512000",
    row: "rgba(255,140,66,0.04)",
    gutter: "#FF8C42",
    icon: IconAudio,
  },
};

const DEFAULT: TrackStyle = {
  clip: "#6B7280",
  label: "#F3F4F6",
  row: "rgba(107,114,128,0.03)",
  gutter: "#6B7280",
  icon: IconComposition,
};

function getStyle(tag: string): TrackStyle {
  const t = tag.toLowerCase();
  if (t.startsWith("h") && t.length === 2 && "123456".includes(t[1])) return STYLES.h1;
  return STYLES[t] ?? DEFAULT;
}

/* ── Tick Generation ────────────────────────────────────────────── */
export function generateTicks(duration: number): { major: number[]; minor: number[] } {
  if (duration <= 0 || !Number.isFinite(duration) || duration > 7200)
    return { major: [], minor: [] };
  const intervals = [0.5, 1, 2, 5, 10, 15, 30, 60];
  const target = duration / 6;
  const majorInterval = intervals.find((i) => i >= target) ?? 60;
  const minorInterval = Math.max(0.25, majorInterval / 2);
  const major: number[] = [];
  const minor: number[] = [];
  const maxTicks = 500; // Safety cap to prevent infinite loop
  for (
    let t = 0;
    t <= duration + 0.001 && major.length + minor.length < maxTicks;
    t += minorInterval
  ) {
    const rounded = Math.round(t * 100) / 100;
    const isMajor =
      Math.abs(rounded % majorInterval) < 0.01 ||
      Math.abs((rounded % majorInterval) - majorInterval) < 0.01;
    if (isMajor) major.push(rounded);
    else minor.push(rounded);
  }
  return { major, minor };
}

export function formatTick(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/* ── Component ──────────────────────────────────────────────────── */
interface TimelineProps {
  /** Called when user seeks via ruler/track click or playhead drag */
  onSeek?: (time: number) => void;
  /** Called when user double-clicks a composition clip to drill into it */
  onDrillDown?: (element: import("../store/playerStore").TimelineElement) => void;
  /** Optional custom content renderer for clips (thumbnails, waveforms, etc.) */
  renderClipContent?: (
    element: import("../store/playerStore").TimelineElement,
    style: { clip: string; label: string },
  ) => ReactNode;
  /** Optional overlay renderer for clips (e.g. badges, cursors) */
  renderClipOverlay?: (element: import("../store/playerStore").TimelineElement) => ReactNode;
  /** Called when files are dropped onto the empty timeline */
  onFileDrop?: (files: File[]) => void;
  /** Called when a clip is moved, resized, or changes track via drag */
  onClipChange?: (
    elementId: string,
    updates: { start?: number; duration?: number; track?: number },
  ) => void;
}

export const Timeline = memo(function Timeline({
  onSeek,
  onDrillDown,
  renderClipContent,
  renderClipOverlay,
  onFileDrop,
}: TimelineProps = {}) {
  const elements = usePlayerStore((s) => s.elements);
  const duration = usePlayerStore((s) => s.duration);
  const timelineReady = usePlayerStore((s) => s.timelineReady);
  const selectedElementId = usePlayerStore((s) => s.selectedElementId);
  const setSelectedElementId = usePlayerStore((s) => s.setSelectedElementId);
  const zoomMode = usePlayerStore((s) => s.zoomMode);
  const manualPps = usePlayerStore((s) => s.pixelsPerSecond);
  const playheadRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hoveredClip, setHoveredClip] = useState<string | null>(null);
  const isDragging = useRef(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);

  // Callback ref: sets up ResizeObserver when the DOM element actually mounts.
  // useMountEffect can't work here because the component returns null on first
  // render (timelineReady=false), so containerRef.current is null when the
  // effect fires and the ResizeObserver is never created.
  const setContainerRef = useCallback((el: HTMLDivElement | null) => {
    if (roRef.current) {
      roRef.current.disconnect();
      roRef.current = null;
    }
    containerRef.current = el;
    if (!el) return;
    setViewportWidth(el.clientWidth);
    roRef.current = new ResizeObserver(([entry]) => {
      setViewportWidth(entry.contentRect.width);
    });
    roRef.current.observe(el);
  }, []);

  // Clean up ResizeObserver on unmount
  useEffect(
    () => () => {
      roRef.current?.disconnect();
    },
    [],
  );

  // Effective duration: max of store duration and the furthest element end.
  // processTimelineMessage updates elements but not duration, so elements can
  // extend beyond the store's duration — this ensures fit mode shows everything.
  const effectiveDuration = useMemo(() => {
    const safeDur = Number.isFinite(duration) ? duration : 0;
    if (elements.length === 0) return safeDur;
    const maxEnd = Math.max(...elements.map((el) => el.start + el.duration));
    const result = Math.max(safeDur, maxEnd);
    return Number.isFinite(result) ? result : safeDur;
  }, [elements, duration]);

  // Calculate effective pixels per second
  // In fit mode, use clientWidth (excludes scrollbar) with a small padding
  const fitPps =
    viewportWidth > GUTTER && effectiveDuration > 0
      ? (viewportWidth - GUTTER - 2) / effectiveDuration
      : 100;
  const pps = zoomMode === "fit" ? fitPps : manualPps;
  const trackContentWidth = Math.max(0, effectiveDuration * pps);

  const durationRef = useRef(effectiveDuration);
  durationRef.current = effectiveDuration;
  const ppsRef = useRef(pps);
  ppsRef.current = pps;
  useMountEffect(() => {
    const unsub = liveTime.subscribe((t) => {
      const dur = durationRef.current;
      if (!playheadRef.current || dur <= 0) return;
      const px = t * ppsRef.current;
      playheadRef.current.style.left = `${GUTTER + px}px`;

      // Auto-scroll to follow playhead during playback or seeking
      const scroll = scrollRef.current;
      if (scroll && !isDragging.current) {
        const playheadX = GUTTER + px;
        const visibleRight = scroll.scrollLeft + scroll.clientWidth;
        const visibleLeft = scroll.scrollLeft;
        const edgeMargin = scroll.clientWidth * 0.12;

        if (playheadX > visibleRight - edgeMargin) {
          // Playhead near right edge — page forward
          scroll.scrollLeft = playheadX - scroll.clientWidth * 0.15;
        } else if (playheadX < visibleLeft + GUTTER) {
          // Playhead before visible area (e.g. loop) — jump back
          scroll.scrollLeft = Math.max(0, playheadX - GUTTER);
        }
      }
    });
    return unsub;
  });

  const dragScrollRaf = useRef(0);

  const seekFromX = useCallback(
    (clientX: number) => {
      const el = scrollRef.current;
      if (!el || effectiveDuration <= 0) return;
      const rect = el.getBoundingClientRect();
      const scrollLeft = el.scrollLeft;
      const x = clientX - rect.left + scrollLeft - GUTTER;
      if (x < 0) return;
      const time = Math.max(0, Math.min(effectiveDuration, x / pps));
      liveTime.notify(time);
      onSeek?.(time);
    },
    [effectiveDuration, onSeek, pps],
  );

  // Auto-scroll the timeline when dragging the playhead near edges
  const autoScrollDuringDrag = useCallback(
    (clientX: number) => {
      cancelAnimationFrame(dragScrollRaf.current);
      const el = scrollRef.current;
      if (!el || !isDragging.current) return;
      const rect = el.getBoundingClientRect();
      const edgeZone = 40;
      const maxSpeed = 12;
      let scrollDelta = 0;

      if (clientX < rect.left + edgeZone) {
        // Near left edge — scroll left
        const proximity = Math.max(0, 1 - (clientX - rect.left) / edgeZone);
        scrollDelta = -maxSpeed * proximity;
      } else if (clientX > rect.right - edgeZone) {
        // Near right edge — scroll right
        const proximity = Math.max(0, 1 - (rect.right - clientX) / edgeZone);
        scrollDelta = maxSpeed * proximity;
      }

      if (scrollDelta !== 0) {
        el.scrollLeft += scrollDelta;
        seekFromX(clientX);
        dragScrollRaf.current = requestAnimationFrame(() => autoScrollDuringDrag(clientX));
      }
    },
    [seekFromX],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest("[data-clip]")) return;
      if (e.button !== 0) return;
      isDragging.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      seekFromX(e.clientX);
    },
    [seekFromX],
  );
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return;
      seekFromX(e.clientX);
      autoScrollDuringDrag(e.clientX);
    },
    [seekFromX, autoScrollDuringDrag],
  );
  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
    cancelAnimationFrame(dragScrollRaf.current);
  }, []);

  const tracks = useMemo(() => {
    const map = new Map<number, typeof elements>();
    for (const el of elements) {
      const list = map.get(el.track) ?? [];
      list.push(el);
      map.set(el.track, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b);
  }, [elements]);

  // Determine dominant style per track (from first element)
  const trackStyles = useMemo(() => {
    const map = new Map<number, TrackStyle>();
    for (const [trackNum, els] of tracks) {
      map.set(trackNum, getStyle(els[0]?.tag ?? ""));
    }
    return map;
  }, [tracks]);

  const { major, minor } = useMemo(() => generateTicks(effectiveDuration), [effectiveDuration]);

  const [isDragOver, setIsDragOver] = useState(false);

  if (!timelineReady || elements.length === 0) {
    return (
      <div
        className={`h-full border-t bg-[#0a0a0b] flex flex-col select-none transition-colors duration-150 ${
          isDragOver ? "border-blue-500/50 bg-blue-500/[0.03]" : "border-neutral-800/50"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          if (onFileDrop && e.dataTransfer.files.length > 0) {
            onFileDrop(Array.from(e.dataTransfer.files));
          }
        }}
      >
        {/* Ruler */}
        <div
          className="flex-shrink-0 border-b border-neutral-800/40 flex items-end relative"
          style={{ height: RULER_H, paddingLeft: GUTTER }}
        >
          {[0, 10, 20, 30, 40, 50].map((s) => (
            <div
              key={s}
              className="flex flex-col items-center"
              style={{ position: "absolute", left: GUTTER + s * 14 }}
            >
              <span className="text-[9px] text-neutral-600 font-mono tabular-nums leading-none mb-0.5">
                {`${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`}
              </span>
              <div className="w-px h-[5px] bg-neutral-700/40" />
            </div>
          ))}
        </div>
        {/* Empty drop zone */}
        <div className="flex-1 flex items-center justify-center">
          <div
            className={`flex items-center gap-3 px-6 py-3 border border-dashed rounded-lg transition-colors duration-150 ${
              isDragOver ? "border-blue-400/60 bg-blue-500/[0.06]" : "border-neutral-700/50"
            }`}
          >
            {isDragOver ? (
              <>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-blue-400 flex-shrink-0"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span className="text-[13px] text-blue-400">Drop media files to import</span>
              </>
            ) : (
              <>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-neutral-600 flex-shrink-0"
                >
                  <rect x="2" y="2" width="20" height="20" rx="2" />
                  <path d="M7 2v20" />
                  <path d="M17 2v20" />
                  <path d="M2 7h20" />
                  <path d="M2 17h20" />
                </svg>
                <span className="text-[13px] text-neutral-500">
                  {onFileDrop
                    ? "Drop media here or describe your video to start"
                    : "Describe your video to start creating"}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  const totalH = RULER_H + tracks.length * TRACK_H;

  return (
    <div
      ref={setContainerRef}
      aria-label="Timeline"
      className="border-t border-neutral-800/50 bg-[#0a0a0b] select-none cursor-crosshair h-full overflow-hidden"
      style={{ touchAction: "pan-x pan-y" }}
    >
      <div
        ref={scrollRef}
        className={`${zoomMode === "fit" ? "overflow-x-hidden" : "overflow-x-auto"} overflow-y-auto h-full`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onLostPointerCapture={handlePointerUp}
      >
        <div className="relative" style={{ height: totalH, width: GUTTER + trackContentWidth }}>
          {/* Grid lines */}
          <svg
            className="absolute pointer-events-none"
            style={{ left: GUTTER, width: trackContentWidth }}
            height={totalH}
          >
            {major.map((t) => {
              const x = t * pps;
              return (
                <line
                  key={`g-${t}`}
                  x1={x}
                  y1={RULER_H}
                  x2={x}
                  y2={totalH}
                  stroke="rgba(255,255,255,0.035)"
                  strokeWidth="1"
                />
              );
            })}
          </svg>

          {/* Ruler */}
          <div
            className="relative border-b border-neutral-800/40 overflow-hidden"
            style={{ height: RULER_H, marginLeft: GUTTER, width: trackContentWidth }}
          >
            {minor.map((t) => (
              <div key={`m-${t}`} className="absolute bottom-0" style={{ left: t * pps }}>
                <div className="w-px h-[3px] bg-neutral-700/40" />
              </div>
            ))}
            {major.map((t) => (
              <div
                key={`M-${t}`}
                className="absolute bottom-0 flex flex-col items-center"
                style={{ left: t * pps }}
              >
                <span className="text-[9px] text-neutral-500 font-mono tabular-nums leading-none mb-0.5">
                  {formatTick(t)}
                </span>
                <div className="w-px h-[5px] bg-neutral-600/60" />
              </div>
            ))}
          </div>

          {/* Tracks */}
          {tracks.map(([trackNum, els]) => {
            const ts = trackStyles.get(trackNum) ?? DEFAULT;
            return (
              <div
                key={trackNum}
                className="relative flex"
                style={{ height: TRACK_H, backgroundColor: ts.row }}
              >
                {/* Gutter: colored icon badge (Figma Motion Cut style) */}
                <div
                  className="flex-shrink-0 flex items-center justify-center"
                  style={{ width: GUTTER }}
                >
                  <div
                    className="flex items-center justify-center"
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      backgroundColor: ts.gutter,
                      border: "1px solid rgba(255,255,255,0.35)",
                      color: "#fff",
                    }}
                  >
                    {ts.icon}
                  </div>
                </div>

                {/* Clips */}
                <div style={{ width: trackContentWidth }} className="relative">
                  {els.map((el, i) => {
                    const clipStyle = getStyle(el.tag);
                    const isSelected = selectedElementId === el.id;
                    const isComposition = !!el.compositionSrc;
                    const clipKey = `${el.id}-${i}`;
                    const isHovered = hoveredClip === clipKey;
                    const hasCustomContent = !!renderClipContent;
                    const clipWidthPx = Math.max(el.duration * pps, 4);

                    return (
                      <TimelineClip
                        key={clipKey}
                        el={el}
                        pps={pps}
                        trackH={TRACK_H}
                        clipY={CLIP_Y}
                        isSelected={isSelected}
                        isHovered={isHovered}
                        hasCustomContent={hasCustomContent}
                        style={clipStyle}
                        isComposition={isComposition}
                        onHoverStart={() => setHoveredClip(clipKey)}
                        onHoverEnd={() => setHoveredClip(null)}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedElementId(isSelected ? null : el.id);
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (isComposition && onDrillDown) onDrillDown(el);
                        }}
                      >
                        {renderClipOverlay?.(el)}
                        <div
                          className={
                            renderClipContent
                              ? "absolute inset-0 overflow-hidden rounded-[4px]"
                              : "flex items-center overflow-hidden flex-1 min-w-0"
                          }
                        >
                          {renderClipContent?.(el, clipStyle) ?? (
                            <>
                              <span
                                className="text-[10px] font-semibold truncate px-1.5 leading-none"
                                style={{ color: clipStyle.label }}
                              >
                                {el.id || el.tag}
                              </span>
                              {clipWidthPx > 60 && (
                                <span
                                  className="text-[9px] font-mono tabular-nums pr-1.5 ml-auto flex-shrink-0 leading-none opacity-70"
                                  style={{ color: clipStyle.label }}
                                >
                                  {el.duration.toFixed(1)}s
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </TimelineClip>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Playhead — z-[100] to stay above all clips (which use z-1 to z-10) */}
          <div
            ref={playheadRef}
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{ left: `${GUTTER}px`, zIndex: 100 }}
          >
            <div
              className="absolute top-0 bottom-0"
              style={{
                left: "50%",
                width: 2,
                marginLeft: -1,
                background: "var(--hf-accent, #3CE6AC)",
                boxShadow: "0 0 8px rgba(60,230,172,0.5)",
              }}
            />
            <div
              className="absolute"
              style={{ left: "50%", top: 0, transform: "translateX(-50%)" }}
            >
              <div
                style={{
                  width: 0,
                  height: 0,
                  borderLeft: "6px solid transparent",
                  borderRight: "6px solid transparent",
                  borderTop: "8px solid var(--hf-accent, #3CE6AC)",
                  filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.6))",
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
