import { memo, useEffect, useMemo, useRef, type Ref, type RefObject } from "react";
import { usePlayerStore } from "../../player";
import { useAudioMetersVisible } from "../../utils/audioMeterVisibility";
import { useStudioShellContext } from "../../contexts/StudioContext";
import {
  METER_DB_MARKS,
  useProjectHasAudio,
  markFraction,
  stepPair,
  type MeterPair as Pair,
} from "../../utils/audioMeterMath";

interface Levels {
  master: { l: number; r: number };
  groups: Record<string, { l: number; r: number }>;
}
interface AudioMeterHook {
  start(): void;
  stop(): void;
  read(): Levels;
}
interface Strip {
  id: string | null;
  label: string;
}
type Bars = { fill: HTMLElement | null; peak: HTMLElement | null };
type StripBars = [Bars, Bars];

const MASTER: Strip = { id: null, label: "Master" };

function useStrips(): Strip[] {
  const elements = usePlayerStore((s) => s.elements);
  return useMemo(() => {
    const labels = new Map<string, string>();
    for (const el of elements) {
      if (el.audioGroup && !labels.has(el.audioGroup)) {
        labels.set(el.audioGroup, el.audioGroupLabel ?? el.audioGroup);
      }
    }
    return [...[...labels].map(([id, label]) => ({ id, label })), MASTER];
  }, [elements]);
}

type PreviewWindow = (Window & { __hf?: { audioMeter?: AudioMeterHook } }) | null | undefined;

function readHook(iframe: HTMLIFrameElement | null): AudioMeterHook | null {
  try {
    return (iframe?.contentWindow as PreviewWindow)?.__hf?.audioMeter ?? null;
  } catch {
    return null;
  }
}

function paint(bars: StripBars | undefined, channels: Pair): void {
  channels.forEach((ch, i) => {
    bars?.[i]?.fill?.style.setProperty("transform", `scaleY(${ch.level})`);
    bars?.[i]?.peak?.style.setProperty("bottom", `${ch.peak * 100}%`);
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
        active?.stop();
        live?.start();
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
      active?.stop();
    };
  }, [previewIframeRef, bars]);
}

function Bar({ fillRef, peakRef }: { fillRef: Ref<HTMLDivElement>; peakRef: Ref<HTMLDivElement> }) {
  return (
    <div className="relative h-full w-1.5 overflow-hidden rounded-[1px] bg-neutral-900">
      <div ref={fillRef} className="absolute inset-0 origin-bottom bg-green-500" />
      <div ref={peakRef} className="absolute inset-x-0 bottom-0 h-px bg-green-400" />
    </div>
  );
}

function MeterStrip({
  strip,
  register,
}: {
  strip: Strip;
  register: (id: string | null, bars: StripBars | null) => void;
}) {
  const refs = [
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
  ] as const;
  useEffect(() => {
    register(strip.id, [
      { fill: refs[0].current, peak: refs[1].current },
      { fill: refs[2].current, peak: refs[3].current },
    ]);
    return () => register(strip.id, null);
    // refs are stable objects
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strip.id, register]);
  return (
    <div className="flex w-16 shrink-0 flex-col items-center gap-1 px-1 pt-2 pb-1">
      <div
        className="flex min-h-0 flex-1 items-stretch gap-0.5"
        aria-label={`${strip.label} level`}
      >
        <Bar fillRef={refs[0]} peakRef={refs[1]} />
        <Bar fillRef={refs[2]} peakRef={refs[3]} />
        <div className="relative ml-1 w-5 font-mono text-[9px] leading-none text-neutral-500">
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
  useMeterLoop(strips, bars);
  return (
    <div
      data-testid="audio-meter-strip"
      className="flex shrink-0 overflow-x-auto border-l border-neutral-800/50 bg-neutral-950"
    >
      {strips.map((strip) => (
        <MeterStrip key={strip.id ?? "master"} strip={strip} register={register} />
      ))}
    </div>
  );
}
