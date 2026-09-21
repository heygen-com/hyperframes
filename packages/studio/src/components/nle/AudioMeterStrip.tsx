import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type Ref,
  type RefObject,
} from "react";
import type { StereoLevel } from "@hyperframes/core/runtime/levelTap";
import { usePlayerStore } from "../../player";
import { useAudioMetersVisible } from "../../utils/audioMeterVisibility";
import { useStudioShellContext } from "../../contexts/StudioContext";
import { useTimelineEditContextOptional } from "../../contexts/TimelineEditContext";
import {
  METER_DB_MARKS,
  useProjectHasAudio,
  fractionToLevel,
  levelToFraction,
  markFraction,
  stepPair,
  type MeterPair as Pair,
} from "../../utils/audioMeterMath";

interface Levels {
  master: StereoLevel;
  groups: Record<string, StereoLevel>;
}
interface AudioMeterHook {
  start(): void;
  stop(): void;
  read(): Levels;
}
interface Strip {
  id: string | null;
  label: string;
  volume: number;
}
type Bars = { mask: HTMLElement | null; peak: HTMLElement | null };
type StripBars = [Bars, Bars];

const MASTER_LABEL = "Master";

/** Where the fill turns amber, then red, on the same piecewise dB scale the marks use. */
const AMBER_AT = markFraction(-6);
const RED_AT = markFraction(-3);

function useStrips(): Strip[] {
  const elements = usePlayerStore((s) => s.elements);
  const masterVolume = usePlayerStore((s) => s.audioVolume);
  return useMemo(() => {
    const labels = new Map<string, string>();
    const volumes = new Map<string, number>();
    for (const el of elements) {
      if (el.audioGroup && !labels.has(el.audioGroup)) {
        labels.set(el.audioGroup, el.audioGroupLabel ?? el.audioGroup);
        volumes.set(el.audioGroup, el.audioGroupVolume ?? 1);
      }
    }
    return [
      ...[...labels].map(([id, label]) => ({ id, label, volume: volumes.get(id) ?? 1 })),
      { id: null, label: MASTER_LABEL, volume: masterVolume },
    ];
  }, [elements, masterVolume]);
}

/** Group volume through the existing `data-volume` write path (live while dragging, one
 *  undo entry on release); master volume through the player store's own volume action —
 *  the same one `VolumeControl` in `PlayerControls` already drives. */
function useVolumeHandlers(): {
  onLive: (id: string | null, volume: number) => void;
  onCommit: (id: string | null, volume: number) => void;
} {
  const { onSetAudioGroupAttributeLive, onSetAudioGroupAttributeQuiet } =
    useTimelineEditContextOptional();
  const setAudioVolume = usePlayerStore((s) => s.setAudioVolume);
  const onLive = useCallback(
    (id: string | null, volume: number) => {
      if (id === null) setAudioVolume(volume);
      else onSetAudioGroupAttributeLive?.(id, "data-volume", String(volume));
    },
    [onSetAudioGroupAttributeLive, setAudioVolume],
  );
  const onCommit = useCallback(
    (id: string | null, volume: number) => {
      if (id === null) setAudioVolume(volume);
      else void onSetAudioGroupAttributeQuiet?.(id, "data-volume", String(volume), "Set volume");
    },
    [onSetAudioGroupAttributeQuiet, setAudioVolume],
  );
  return { onLive, onCommit };
}

type PreviewWindow = (Window & { __hf?: { audioMeter?: AudioMeterHook } }) | null | undefined;

function readHook(iframe: HTMLIFrameElement | null): AudioMeterHook | null {
  try {
    return (iframe?.contentWindow as PreviewWindow)?.__hf?.audioMeter ?? null;
  } catch {
    return null;
  }
}

/** 0 dB is bottom 100% plus 1px down, so the tick stays inside overflow-hidden.
 *  A calc() bottom does not stick as an inline style on Windows happy-dom. */
function paintPeak(el: HTMLElement | null, peak: number): void {
  if (!el) return;
  el.style.setProperty("bottom", `${peak * 100}%`);
  el.style.setProperty("transform", peak >= 1 ? "translateY(1px)" : "none");
}

/** The fill is a fixed green/amber/red backdrop; painting only moves the dark
 *  mask that covers the unlit top portion, so a loud peak lights the real red
 *  band instead of tinting a flat colour brighter. */
function paint(bars: StripBars | undefined, channels: Pair): void {
  channels.forEach((ch, i) => {
    bars?.[i]?.mask?.style.setProperty("height", `${(1 - ch.level) * 100}%`);
    paintPeak(bars?.[i]?.peak ?? null, ch.peak);
  });
}

/** One rAF loop re-reads the hook off the live preview window, so a reloaded iframe is followed. */
function useMeterLoop(strips: Strip[], bars: RefObject<Map<string | null, StripBars>>) {
  const { previewIframeRef } = useStudioShellContext();
  const stripsRef = useRef(strips);
  stripsRef.current = strips;
  useEffect(() => {
    let raf = 0;
    let active: AudioMeterHook | null = null;
    let last = performance.now();
    const state = new Map<string | null, Pair>();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const live = readHook(previewIframeRef.current);
      if (live !== active) {
        try {
          active?.stop();
        } catch {
          // Preview iframe was torn down; the old hook is uncallable.
        }
        try {
          live?.start();
        } catch {
          // New preview is not ready to attach yet.
        }
        active = live;
      }
      const levels = active?.read();
      const dt = now - last;
      last = now;
      for (const { id } of stripsRef.current) {
        const next = stepPair(
          state.get(id),
          id === null ? levels?.master : levels?.groups[id],
          now,
          dt,
        );
        if (next === state.get(id)) continue;
        state.set(id, next);
        paint(bars.current.get(id), next);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      try {
        active?.stop();
      } catch {
        // Preview iframe already gone.
      }
    };
  }, [previewIframeRef, bars]);
}

function Bar({ maskRef, peakRef }: { maskRef: Ref<HTMLDivElement>; peakRef: Ref<HTMLDivElement> }) {
  return (
    <div className="relative h-full w-[18px] overflow-hidden rounded-[2px] bg-neutral-900">
      <div
        className="absolute inset-x-0 bottom-0 bg-green-500"
        style={{ height: `${AMBER_AT * 100}%` }}
      />
      <div
        className="absolute inset-x-0 bg-amber-500"
        style={{ bottom: `${AMBER_AT * 100}%`, height: `${(RED_AT - AMBER_AT) * 100}%` }}
      />
      <div
        className="absolute inset-x-0 top-0 bg-red-500"
        style={{ height: `${(1 - RED_AT) * 100}%` }}
      />
      <div
        ref={maskRef}
        data-testid="meter-mask"
        className="absolute inset-x-0 top-0 bg-neutral-900"
        style={{ height: "100%" }}
      />
      <div
        ref={peakRef}
        data-testid="meter-peak"
        className="absolute inset-x-0 bottom-0 h-px bg-white"
      />
    </div>
  );
}

/** A vertical fader beside the meter, reusing the meter's own dB scale for its
 *  travel so the thumb lines up with the marks. Dragging anywhere on the
 *  track jumps the thumb there, not just grabbing it exactly. */
function Fader({
  label,
  volume,
  onLive,
  onCommit,
}: {
  label: string;
  volume: number;
  onLive: (v: number) => void;
  onCommit: (v: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const fraction = levelToFraction(Math.min(volume, 1));

  const fractionAt = useCallback(
    (clientY: number): number => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.height === 0) return fraction;
      return Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
    },
    [fraction],
  );

  const nudge = useCallback(
    (delta: number) => onCommit(fractionToLevel(Math.max(0, Math.min(1, fraction + delta)))),
    [onCommit, fraction],
  );

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fraction * 100)}
      onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        draggingRef.current = true;
        onLive(fractionToLevel(fractionAt(e.clientY)));
      }}
      onPointerMove={(e: ReactPointerEvent<HTMLDivElement>) => {
        if (!draggingRef.current) return;
        onLive(fractionToLevel(fractionAt(e.clientY)));
      }}
      onPointerUp={(e: ReactPointerEvent<HTMLDivElement>) => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        onCommit(fractionToLevel(fractionAt(e.clientY)));
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp") nudge(0.02);
        else if (e.key === "ArrowDown") nudge(-0.02);
        else return;
        e.preventDefault();
      }}
      className="relative h-full w-2 shrink-0 cursor-ns-resize touch-none rounded-full bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-studio-accent"
    >
      <div
        className="absolute inset-x-[-3px] h-1.5 -translate-y-1/2 rounded-full bg-neutral-200"
        style={{ bottom: `${fraction * 100}%` }}
      />
    </div>
  );
}

function MeterStrip({
  strip,
  register,
  onLive,
  onCommit,
}: {
  strip: Strip;
  register: (id: string | null, bars: StripBars | null) => void;
  onLive: (id: string | null, volume: number) => void;
  onCommit: (id: string | null, volume: number) => void;
}) {
  const refs = [
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
  ] as const;
  useEffect(() => {
    register(strip.id, [
      { mask: refs[0].current, peak: refs[1].current },
      { mask: refs[2].current, peak: refs[3].current },
    ]);
    return () => register(strip.id, null);
    // refs are stable objects
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strip.id, register]);
  return (
    <div className="flex w-[104px] shrink-0 flex-col items-center gap-1 px-1.5 pt-2 pb-1">
      <div
        className="flex min-h-0 flex-1 items-stretch gap-1.5"
        aria-label={`${strip.label} level`}
      >
        <Fader
          label={`${strip.label} volume`}
          volume={strip.volume}
          onLive={(v) => onLive(strip.id, v)}
          onCommit={(v) => onCommit(strip.id, v)}
        />
        <div className="relative w-5 font-mono text-[9px] leading-none text-neutral-500">
          {METER_DB_MARKS.map((db) => (
            <span
              key={db}
              className="absolute right-0 translate-y-1/2"
              style={{ bottom: `${markFraction(db) * 100}%` }}
            >
              {db}
            </span>
          ))}
        </div>
        <div className="flex items-stretch gap-0.5">
          <Bar maskRef={refs[0]} peakRef={refs[1]} />
          <Bar maskRef={refs[2]} peakRef={refs[3]} />
        </div>
      </div>
      <span className="max-w-full truncate text-[10px] text-neutral-400" title={strip.label}>
        {strip.label}
      </span>
    </div>
  );
}

export const AudioMeterStrip = memo(function AudioMeterStrip() {
  const visible = useAudioMetersVisible((s) => s.visible);
  const projectHasAudio = useProjectHasAudio();
  if (!visible || !projectHasAudio) return null;
  return <MeterStripBody />;
});

function MeterStripBody() {
  const strips = useStrips();
  const bars = useRef(new Map<string | null, StripBars>());
  const register = useRef((id: string | null, b: StripBars | null) => {
    if (b) bars.current.set(id, b);
    else bars.current.delete(id);
  }).current;
  const { onLive, onCommit } = useVolumeHandlers();
  useMeterLoop(strips, bars);
  return (
    <div
      data-testid="audio-meter-strip"
      className="flex shrink-0 overflow-x-auto border-l border-neutral-800/50 bg-neutral-950"
    >
      {strips.map((strip) => (
        <MeterStrip
          key={strip.id ?? "master"}
          strip={strip}
          register={register}
          onLive={onLive}
          onCommit={onCommit}
        />
      ))}
    </div>
  );
}
