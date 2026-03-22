import { useRef, useMemo, useCallback, useState, memo, type ReactNode } from "react";
import { usePlayerStore, liveTime } from "../store/playerStore";
import { useMountEffect } from "../lib/useMountEffect";

/* ── Layout ─────────────────────────────────────────────────────── */
const GUTTER = 32;
const TRACK_H = 28;
const RULER_H = 24;
const CLIP_Y = 2; // vertical inset inside track

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

/* ── Icons from Figma HyperFrames design system ── */
const ICON_BASE = "/icons/timeline";
function TimelineIcon({ src }: { src: string }) {
  return <img src={src} alt="" width={12} height={12} style={{ filter: "brightness(0) invert(1)" }} draggable={false} />;
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
function generateTicks(duration: number): { major: number[]; minor: number[] } {
  if (duration <= 0) return { major: [], minor: [] };
  const intervals = [0.5, 1, 2, 5, 10, 15, 30, 60];
  const target = duration / 6;
  const majorInterval = intervals.find((i) => i >= target) ?? 60;
  const minorInterval = majorInterval / 2;
  const major: number[] = [];
  const minor: number[] = [];
  for (let t = 0; t <= duration + 0.001; t += minorInterval) {
    const rounded = Math.round(t * 100) / 100;
    const isMajor = Math.abs(rounded % majorInterval) < 0.01 || Math.abs(rounded % majorInterval - majorInterval) < 0.01;
    if (isMajor) major.push(rounded);
    else minor.push(rounded);
  }
  return { major, minor };
}

function formatTick(s: number): string {
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
}

export const Timeline = memo(function Timeline({ onSeek, onDrillDown }: TimelineProps = {}) {
  const elements = usePlayerStore((s) => s.elements);
  const duration = usePlayerStore((s) => s.duration);
  const timelineReady = usePlayerStore((s) => s.timelineReady);
  const selectedElementId = usePlayerStore((s) => s.selectedElementId);
  const setSelectedElementId = usePlayerStore((s) => s.setSelectedElementId);
  const activeEdits = usePlayerStore((s) => s.activeEdits);
  const playheadRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredClip, setHoveredClip] = useState<string | null>(null);
  const isDragging = useRef(false);

  const durationRef = useRef(duration);
  durationRef.current = duration;
  useMountEffect(() => {
    const unsub = liveTime.subscribe((t) => {
      const dur = durationRef.current;
      if (!playheadRef.current || dur <= 0) return;
      const pct = (t / dur) * 100;
      playheadRef.current.style.left = `calc(${GUTTER}px + (100% - ${GUTTER}px) * ${pct / 100})`;
    });
    return unsub;
  });

  const seekFromX = useCallback(
    (clientX: number) => {
      const el = containerRef.current;
      if (!el || duration <= 0) return;
      const rect = el.getBoundingClientRect();
      const start = rect.left + GUTTER;
      const w = rect.width - GUTTER;
      if (w <= 0) return;
      const pct = Math.max(0, Math.min(1, (clientX - start) / w));
      const time = pct * duration;
      // Notify liveTime for instant visual update (direct DOM, no re-render)
      liveTime.notify(time);
      // Call parent's onSeek to actually seek the iframe/player
      onSeek?.(time);
    },
    [duration, onSeek],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest("[data-clip]")) return;
      isDragging.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      seekFromX(e.clientX);
    },
    [seekFromX],
  );
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => { if (isDragging.current) seekFromX(e.clientX); },
    [seekFromX],
  );
  const handlePointerUp = useCallback(() => { isDragging.current = false; }, []);

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

  const { major, minor } = useMemo(() => generateTicks(duration), [duration]);

  if (!timelineReady) return null;
  if (elements.length === 0) {
    return <div className="px-3 py-3 text-2xs text-neutral-600 border-t border-neutral-800/50">No timeline elements</div>;
  }

  const totalH = RULER_H + tracks.length * TRACK_H;

  return (
    <div
      ref={containerRef}
      aria-label="Timeline"
      className="border-t border-neutral-800/50 bg-[#0a0a0b] select-none overflow-x-hidden cursor-crosshair"
      style={{ touchAction: "none" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div className="relative" style={{ height: totalH }}>
        {/* Grid lines */}
        <svg className="absolute pointer-events-none" style={{ left: GUTTER }} width={`calc(100% - ${GUTTER}px)`} height={totalH}>
          {major.map((t) => (
            <line key={`g-${t}`} x1={`${(t / duration) * 100}%`} y1={RULER_H} x2={`${(t / duration) * 100}%`} y2={totalH} stroke="rgba(255,255,255,0.035)" strokeWidth="1" />
          ))}
        </svg>

        {/* Ruler */}
        <div className="relative border-b border-neutral-800/40" style={{ height: RULER_H, marginLeft: GUTTER }}>
          {minor.map((t) => (
            <div key={`m-${t}`} className="absolute bottom-0" style={{ left: `${(t / duration) * 100}%` }}>
              <div className="w-px h-[3px] bg-neutral-700/40" />
            </div>
          ))}
          {major.map((t) => (
            <div key={`M-${t}`} className="absolute bottom-0 flex flex-col items-center" style={{ left: `${(t / duration) * 100}%` }}>
              <span className="text-[9px] text-neutral-500 font-mono tabular-nums leading-none mb-0.5">{formatTick(t)}</span>
              <div className="w-px h-[5px] bg-neutral-600/60" />
            </div>
          ))}
        </div>

        {/* Tracks */}
        {tracks.map(([trackNum, els]) => {
          const ts = trackStyles.get(trackNum) ?? DEFAULT;
          return (
            <div key={trackNum} className="relative flex" style={{ height: TRACK_H, backgroundColor: ts.row }}>
              {/* Gutter: colored icon badge (Figma HyperFrames style) */}
              <div className="flex-shrink-0 flex items-center justify-center" style={{ width: GUTTER }}>
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
              <div className="flex-1 relative">
                {els.map((el, i) => {
                  const leftPct = (el.start / duration) * 100;
                  const widthPct = (el.duration / duration) * 100;
                  const style = getStyle(el.tag);
                  const isSelected = selectedElementId === el.id;
                  const isComposition = !!el.compositionSrc;
                  const clipKey = `${el.id}-${i}`;
                  const isHovered = hoveredClip === clipKey;
                  const activeEdit = activeEdits[el.id];
                  const isBeingEdited = !!activeEdit;

                  return (
                    <div
                      key={clipKey}
                      data-clip="true"
                      className="absolute flex items-center overflow-hidden"
                      style={{
                        left: `${leftPct}%`,
                        width: `${Math.max(widthPct, 1)}%`,
                        top: CLIP_Y,
                        bottom: CLIP_Y,
                        borderRadius: 5,
                        backgroundColor: style.clip,
                        backgroundImage: isComposition
                          ? `repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(255,255,255,0.08) 3px, rgba(255,255,255,0.08) 6px)`
                          : undefined,
                        border: isSelected ? `2px solid rgba(255,255,255,0.9)` : `1px solid rgba(255,255,255,${isHovered ? 0.3 : 0.15})`,
                        boxShadow: isSelected
                          ? `0 0 0 1px ${style.clip}, 0 2px 8px rgba(0,0,0,0.4)`
                          : isBeingEdited
                            ? `0 0 0 1px ${activeEdit.agentColor}80, 0 0 8px ${activeEdit.agentColor}40`
                            : isHovered
                              ? "0 1px 4px rgba(0,0,0,0.3)"
                              : "none",
                        cursor: "pointer",
                        transition: "border-color 120ms, box-shadow 120ms, transform 80ms",
                        transform: isHovered && !isSelected ? "scaleY(1.04)" : "scaleY(1)",
                        zIndex: isSelected ? 10 : isHovered ? 5 : 1,
                      }}
                      title={isComposition
                        ? `${el.compositionSrc} \u2022 Double-click to open`
                        : `${el.id || el.tag} \u2022 ${el.start.toFixed(1)}s \u2013 ${(el.start + el.duration).toFixed(1)}s`}
                      onPointerEnter={() => setHoveredClip(clipKey)}
                      onPointerLeave={() => setHoveredClip(null)}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedElementId(isSelected ? null : el.id);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        if (isComposition && onDrillDown) {
                          onDrillDown(el);
                        }
                      }}
                    >
                      {/* Agent ownership dot */}
                      {el.agentColor && (
                        <div
                          className="flex-shrink-0 w-1.5 h-1.5 rounded-full ml-1"
                          style={{ backgroundColor: el.agentColor }}
                          title={el.agentId ? `Agent: ${el.agentId}` : undefined}
                        />
                      )}
                      {/* Editing glow pulse */}
                      {/* Agent editing indicator — cursor on the clip */}
                      {isBeingEdited && (
                        <>
                          <div
                            className="absolute inset-0 rounded-[5px] animate-pulse pointer-events-none"
                            style={{ boxShadow: `inset 0 0 0 1px ${activeEdit.agentColor}60` }}
                          />
                          {/* Agent name badge above clip */}
                          <div
                            className="absolute pointer-events-none flex items-center gap-1"
                            style={{
                              top: -16,
                              left: 2,
                              zIndex: 30,
                            }}
                          >
                            {/* Mini cursor arrow */}
                            <svg width="8" height="10" viewBox="0 0 12 16" fill="none" style={{ flexShrink: 0 }}>
                              <path d="M1 1L11 7L6 8L4 14L1 1Z" fill={activeEdit.agentColor} stroke="white" strokeWidth="0.8" />
                            </svg>
                            <span
                              className="text-[8px] font-semibold px-1 py-px rounded whitespace-nowrap"
                              style={{
                                backgroundColor: activeEdit.agentColor,
                                color: "white",
                                boxShadow: `0 1px 4px ${activeEdit.agentColor}40`,
                              }}
                            >
                              {activeEdit.agentId}
                            </span>
                          </div>
                        </>
                      )}
                      <span
                        className="text-[10px] font-semibold truncate px-1.5 leading-none"
                        style={{ color: style.label }}
                      >
                        {el.id || el.tag}
                      </span>
                      {widthPct > 10 && (
                        <span
                          className="text-[9px] font-mono tabular-nums pr-1.5 ml-auto flex-shrink-0 leading-none opacity-70"
                          style={{ color: style.label }}
                        >
                          {el.duration.toFixed(1)}s
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Playhead */}
        <div
          ref={playheadRef}
          className="absolute top-0 bottom-0 z-20 pointer-events-none"
          style={{ left: `${GUTTER}px` }}
        >
          <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-px bg-white/90" />
          <div className="absolute left-1/2 -translate-x-1/2" style={{ top: 0 }}>
            <div style={{
              width: 0,
              height: 0,
              borderLeft: "5px solid transparent",
              borderRight: "5px solid transparent",
              borderTop: "7px solid rgba(255,255,255,0.95)",
            }} />
          </div>
        </div>
      </div>
    </div>
  );
});
