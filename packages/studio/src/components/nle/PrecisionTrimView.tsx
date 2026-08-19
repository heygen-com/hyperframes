import { useCallback, useEffect, useRef, useState } from "react";
import { usePlayerStore } from "../../player";
import { activeTrimMode } from "../../player/components/timelineTrimTools";
import type { TimelineTrimPreview } from "../../player/store/trimPreviewSlice";

/**
 * The two-up precision view: the frame on each side of the edit point being
 * trimmed, live, while the gesture runs.
 *
 * Each pane is its own preview iframe of the current composition, seeked to its
 * own time — the same live-preview-in-an-iframe pattern the composition cards
 * use. Two players is why the panel mounts as soon as a trim tool is picked
 * rather than when the drag starts: a composition takes a moment to load, and a
 * pane that arrives after the gesture is over is worth nothing. While idle the
 * panes straddle the playhead, so they always show something true.
 */

interface PrecisionTrimViewProps {
  /** Preview URL of the composition the timeline is currently editing. */
  previewUrl: string | null;
}

const PANE_LABELS: Record<TimelineTrimPreview["mode"], [string, string]> = {
  ripple: ["Outgoing", "Incoming"],
  roll: ["Outgoing", "Incoming"],
  slide: ["Outgoing", "Incoming"],
  // Slip moves no edit point: what changes is which part of the source plays.
  slip: ["Clip in", "Clip out"],
};

interface PreviewWindow extends Window {
  __player?: { seek?: (time: number) => void; pause?: () => void };
}

const DEFAULT_STAGE = { width: 1920, height: 1080 };

/** One pane: a paused preview of the composition held at a single frame. */
function PrecisionPane({
  previewUrl,
  time,
  label,
  align,
}: {
  previewUrl: string;
  time: number;
  label: string;
  align: "left" | "right";
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const readyRef = useRef(false);
  const [stage, setStage] = useState(DEFAULT_STAGE);
  const [paneSize, setPaneSize] = useState({ width: 0, height: 0 });

  const hold = useCallback((at: number) => {
    try {
      const player = (iframeRef.current?.contentWindow as PreviewWindow | null)?.__player;
      player?.pause?.();
      player?.seek?.(at);
    } catch {
      /* the preview is still loading, or gone */
    }
  }, []);

  // Seek imperatively: the gesture republishes a new time on every pointer
  // move, and re-rendering an iframe would reload the composition each frame.
  useEffect(() => {
    if (readyRef.current) hold(time);
  }, [time, hold]);

  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setPaneSize({ width, height });
    });
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);

  // The composition renders at its authored size; letterbox it into the pane
  // rather than showing the top-left corner of a 1920×1080 frame.
  const scale =
    paneSize.width > 0 ? Math.min(paneSize.width / stage.width, paneSize.height / stage.height) : 0;

  return (
    <div
      ref={paneRef}
      className="relative flex-1 min-w-0 overflow-hidden rounded-md border border-neutral-800/70 bg-black"
    >
      <iframe
        ref={iframeRef}
        src={previewUrl}
        sandbox="allow-scripts allow-same-origin"
        title={`${label} frame`}
        tabIndex={-1}
        className="pointer-events-none absolute border-none"
        style={{
          width: stage.width,
          height: stage.height,
          transformOrigin: "0 0",
          left: (paneSize.width - stage.width * scale) / 2,
          top: (paneSize.height - stage.height * scale) / 2,
          transform: `scale(${scale})`,
          opacity: scale > 0 ? 1 : 0,
        }}
        onLoad={() => {
          readyRef.current = true;
          try {
            const root = iframeRef.current?.contentDocument?.querySelector("[data-composition-id]");
            setStage({
              width: Number(root?.getAttribute("data-width")) || DEFAULT_STAGE.width,
              height: Number(root?.getAttribute("data-height")) || DEFAULT_STAGE.height,
            });
          } catch {
            setStage(DEFAULT_STAGE);
          }
          hold(time);
        }}
      />
      <div
        className={`absolute bottom-1 ${align === "left" ? "left-1" : "right-1"} rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] leading-none tabular-nums text-neutral-300`}
      >
        {label} · {time.toFixed(2)}s
      </div>
    </div>
  );
}

export function PrecisionTrimView({ previewUrl }: PrecisionTrimViewProps) {
  const activeTool = usePlayerStore((s) => s.activeTool);
  const enabled = usePlayerStore((s) => s.precisionTrimViewEnabled);
  const trimPreview = usePlayerStore((s) => s.trimPreview);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const setTrimPreview = usePlayerStore((s) => s.setTrimPreview);
  const mode = activeTrimMode(activeTool);
  const shown = Boolean(mode && enabled && previewUrl);

  // A finished gesture leaves its cut on screen — you have just trimmed it and
  // that is what you want to look at. It only goes stale once the panel closes
  // (the tool changed, or the view was switched off), so that is where it is
  // dropped. Guarded so the common closed case is not a null-to-null write.
  useEffect(() => {
    if (!shown && usePlayerStore.getState().trimPreview) setTrimPreview(null);
  }, [shown, setTrimPreview]);

  if (!shown || !previewUrl || !mode) return null;

  const [outLabel, inLabel] = PANE_LABELS[trimPreview?.mode ?? mode];
  const outTime = trimPreview?.outTime ?? Math.max(0, currentTime - 1 / 30);
  const inTime = trimPreview?.inTime ?? currentTime;
  const delta = trimPreview?.delta ?? 0;

  return (
    <div
      data-precision-trim-view
      className="flex flex-shrink-0 items-stretch gap-1.5 border-b border-neutral-800/60 bg-neutral-950 px-2 pb-1.5"
      style={{ height: 132 }}
    >
      <PrecisionPane previewUrl={previewUrl} time={outTime} label={outLabel} align="left" />
      <div className="flex w-20 flex-col items-center justify-center gap-0.5 text-center">
        <span className="text-[10px] uppercase tracking-wide text-neutral-500">{mode}</span>
        <span
          className={`font-mono text-xs tabular-nums ${delta === 0 ? "text-neutral-500" : "text-studio-accent"}`}
        >
          {delta > 0 ? "+" : ""}
          {delta.toFixed(2)}s
        </span>
      </div>
      <PrecisionPane previewUrl={previewUrl} time={inTime} label={inLabel} align="right" />
    </div>
  );
}
