import { memo, useState, useRef, useEffect, useId } from "react";
import { RenderQueueItem } from "./RenderQueueItem";
import { Button } from "../ui/Button";
import type { RenderJob, ResolutionPreset } from "./useRenderQueue";
import { getPersistedRenderSettings, persistRenderSettings } from "./renderSettings";
import { trackStudioEvent } from "../../utils/studioTelemetry";

export interface CompositionDimensions {
  width: number;
  height: number;
}

type StartRenderHandler = (
  format: "mp4" | "webm" | "mov",
  quality: "draft" | "standard" | "high",
  resolution: ResolutionPreset | "auto",
  fps: 24 | 30 | 60,
) => void | Promise<void>;

interface RenderQueueProps {
  jobs: RenderJob[];
  projectId: string;
  onDelete: (jobId: string) => void;
  onCancel?: (jobId: string) => void;
  onClearCompleted: () => void;
  onStartRender: StartRenderHandler;
  isRendering: boolean;
  /** History fetch failure (null when the last load succeeded). */
  loadError?: string | null;
  /** Retry a failed history load. */
  onRetryLoad?: () => void;
  /** Failure of a delete/cancel action, shown inline until dismissed. */
  actionError?: string | null;
  onDismissActionError?: () => void;
  /**
   * Authored dimensions of the active composition. Used to pick the
   * matching preset (landscape / portrait / square) when the user selects
   * a 1080p or 4K scale. `null` falls back to landscape (legacy default).
   */
  compositionDimensions?: CompositionDimensions | null;
}

// Orientation is derived from the composition's authored aspect ratio,
// not chosen by the user — picking "1080p portrait" for a landscape comp
// would just produce a wrong-aspect render.
type RenderScale = "auto" | "1080p" | "4k";

const SCALE_OPTION_ORDER: RenderScale[] = ["auto", "1080p", "4k"];

const SCALE_LABEL: Record<RenderScale, string> = {
  auto: "Auto",
  "1080p": "1080p",
  "4k": "4K",
};

// Mirrors `CANVAS_DIMENSIONS` in @hyperframes/core. Studio can't import from
// the core barrel (it transitively pulls in node:fs) and the values are stable.
const CANVAS_DIMENSIONS: Record<ResolutionPreset, CompositionDimensions> = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
  "landscape-4k": { width: 3840, height: 2160 },
  "portrait-4k": { width: 2160, height: 3840 },
  square: { width: 1080, height: 1080 },
  "square-4k": { width: 2160, height: 2160 },
};

type CompAspect = "landscape" | "portrait" | "square";

function compAspect(dims: CompositionDimensions | null | undefined): CompAspect {
  // Missing dims fall through to landscape (legacy default — "landscape" was
  // the first preset). Studio shows resolved dims inline, so the user can see
  // when this fallback is in effect.
  if (dims == null) return "landscape";
  if (dims.width === dims.height) return "square";
  return dims.height > dims.width ? "portrait" : "landscape";
}

function resolveResolution(
  scale: RenderScale,
  dims: CompositionDimensions | null | undefined,
): ResolutionPreset | "auto" {
  if (scale === "auto") return "auto";
  const aspect = compAspect(dims);
  if (scale === "1080p") return aspect;
  return aspect === "landscape"
    ? "landscape-4k"
    : aspect === "portrait"
      ? "portrait-4k"
      : "square-4k";
}

function resolvedDimensions(
  scale: RenderScale,
  dims: CompositionDimensions | null | undefined,
): CompositionDimensions | null {
  if (scale === "auto") return dims ?? null;
  const preset = resolveResolution(scale, dims);
  return preset === "auto" ? null : CANVAS_DIMENSIONS[preset];
}

// Mirrors the producer's resolveDeviceScaleFactor validation
// (renderOrchestrator.ts:608): the chosen preset must match the comp's aspect
// ratio exactly (cross-multiplied), can't downsample, and must be an integer
// scale factor. Without this guard the user can pick a preset that throws at
// render time — e.g. 1080p on a 1080×1080 square or 1080p on a 1280×720 comp
// (1.5× isn't integer).
function scaleApplies(scale: RenderScale, dims: CompositionDimensions | null | undefined): boolean {
  if (scale === "auto" || dims == null) return true;
  const preset = resolveResolution(scale, dims);
  if (preset === "auto") return true;
  const target = CANVAS_DIMENSIONS[preset];
  if (target.width * dims.height !== target.height * dims.width) return false;
  if (target.width < dims.width) return false;
  return Number.isInteger(target.width / dims.width);
}

function scaleOptionLabel(
  scale: RenderScale,
  dims: CompositionDimensions | null | undefined,
): string {
  const resolved = resolvedDimensions(scale, dims);
  const base = resolved
    ? `${SCALE_LABEL[scale]} · ${resolved.width}×${resolved.height}`
    : SCALE_LABEL[scale];
  // Explain *why* an option is disabled instead of greying it silently:
  // the preset must be an exact integer upscale of the authored size.
  if (dims && !scaleApplies(scale, dims)) {
    return `${base} — not an integer scale of ${dims.width}×${dims.height}`;
  }
  return base;
}

const FORMAT_INFO: Record<"mp4" | "webm" | "mov", { label: string; desc: string }> = {
  mp4: { label: "MP4", desc: "Best for general use. Smallest file, universal playback." },
  mov: {
    label: "MOV (ProRes 4444)",
    desc: "Transparent video. Works in Final Cut Pro, DaVinci Resolve, and most video editors. Large files.",
  },
  webm: {
    label: "WebM (VP9)",
    desc: "Transparent video for web. Smaller than MOV but limited editor support.",
  },
};

// Rich format guidance in a keyboard-reachable disclosure: the trigger is a
// real button (focusable, labelled), the panel is tied to it via
// aria-describedby, and Escape dismisses (WCAG 1.4.13). Content is too rich
// for the one-line ui/Tooltip primitive, so this stays a local popover.
function FormatInfoTooltip({ format }: { format: "mp4" | "webm" | "mov" }) {
  const [open, setOpen] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const panelId = useId();

  const show = () => {
    clearTimeout(timeoutRef.current);
    setOpen(true);
  };
  const hide = () => {
    timeoutRef.current = setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const info = FORMAT_INFO[format];

  return (
    <div className="relative" onPointerEnter={show} onPointerLeave={hide}>
      <button
        type="button"
        aria-label="About video formats"
        aria-expanded={open}
        aria-describedby={open ? panelId : undefined}
        onFocus={show}
        onBlur={hide}
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center justify-center p-0.5 -m-0.5 rounded text-panel-text-5 hover:text-panel-text-3 transition-colors cursor-help outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-studio-accent"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </button>
      {open && (
        <div
          id={panelId}
          role="tooltip"
          className="absolute top-full right-0 mt-1.5 w-52 p-2 rounded bg-panel-input border border-neutral-700 shadow-lg z-50"
        >
          <p className="text-[10px] font-semibold text-panel-text-1 mb-0.5">{info.label}</p>
          <p className="text-[9px] text-panel-text-3 leading-tight">{info.desc}</p>
          <div className="mt-1.5 pt-1.5 border-t border-neutral-800">
            {(["mp4", "mov", "webm"] as const)
              .filter((f) => f !== format)
              .map((f) => (
                <p key={f} className="text-[9px] text-panel-text-4 leading-relaxed">
                  <span className="text-panel-text-3 font-medium">{FORMAT_INFO[f].label}</span>
                  {" — "}
                  {FORMAT_INFO[f].desc}
                </p>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

const QUALITY_OPTIONS: {
  value: "draft" | "standard" | "high";
  label: string;
  title: string;
}[] = [
  { value: "draft", label: "Draft", title: "Fast render, smaller file" },
  { value: "standard", label: "Standard", title: "Good quality, balanced file size" },
  { value: "high", label: "High Quality", title: "Best quality, larger file" },
];

function formatEta(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function FormatExportButton({
  onStartRender,
  isRendering,
  compositionDimensions,
  lastRenderDurationMs,
}: {
  onStartRender: StartRenderHandler;
  isRendering: boolean;
  compositionDimensions?: CompositionDimensions | null;
  lastRenderDurationMs?: number;
}) {
  const persisted = getPersistedRenderSettings();
  const [format, setFormat] = useState<"mp4" | "webm" | "mov">(persisted.format);
  const [quality, setQuality] = useState<"draft" | "standard" | "high">(persisted.quality);
  const [resolution, setResolution] = useState<ResolutionPreset | "auto">("auto");
  const [fps, setFps] = useState<24 | 30 | 60>(persisted.fps);

  // MOV (ProRes) is a fixed-quality codec — quality selector has no effect.
  const showQuality = format !== "mov";

  const selectCls =
    "h-7 w-full px-2 text-[11px] bg-panel-input rounded-md text-panel-text-1 outline-none cursor-pointer disabled:opacity-50 hover:bg-panel-hover transition-colors";

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-panel-text-4">Format</span>
            <FormatInfoTooltip format={format} />
          </div>
          <select
            value={format}
            onChange={(e) => {
              const v = e.target.value as "mp4" | "webm" | "mov";
              setFormat(v);
              persistRenderSettings(v, quality, fps);
            }}
            disabled={isRendering}
            className={selectCls}
          >
            <option value="mp4">MP4</option>
            <option value="mov">MOV (ProRes)</option>
            <option value="webm">WebM</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-panel-text-4">Resolution</span>
          <select
            value={resolution}
            onChange={(e) => setResolution(e.target.value as ResolutionPreset | "auto")}
            disabled={isRendering}
            className={selectCls}
          >
            {SCALE_OPTION_ORDER.map((value) => (
              <option
                key={value}
                value={value}
                disabled={!scaleApplies(value, compositionDimensions)}
              >
                {scaleOptionLabel(value, compositionDimensions)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-panel-text-4">Frame rate</span>
          <select
            value={fps}
            onChange={(e) => {
              const v = Number(e.target.value) as 24 | 30 | 60;
              setFps(v);
              persistRenderSettings(format, quality, v);
            }}
            disabled={isRendering}
            className={selectCls}
          >
            <option value={24}>24 fps</option>
            <option value={30}>30 fps</option>
            <option value={60}>60 fps</option>
          </select>
        </div>
        {showQuality && (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-panel-text-4">Quality</span>
            <select
              value={quality}
              onChange={(e) => {
                const v = e.target.value as "draft" | "standard" | "high";
                setQuality(v);
                persistRenderSettings(format, v, fps);
              }}
              disabled={isRendering}
              className={selectCls}
            >
              {QUALITY_OPTIONS.map((q) => (
                <option key={q.value} value={q.value}>
                  {q.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <Button
        variant="primary"
        size="md"
        loading={isRendering}
        onClick={() => {
          // loading already disables the button; this guard also stops a
          // double-click in the same frame from enqueueing two renders.
          if (isRendering) return;
          trackStudioEvent("render_start", { format, quality, resolution, fps });
          void onStartRender(format, quality, resolution, fps);
        }}
        className="w-full text-[11px] font-semibold"
      >
        {isRendering ? "Rendering…" : "Export"}
      </Button>
      {lastRenderDurationMs !== undefined && !isRendering && (
        <p className="text-[9px] text-panel-text-5 text-center -mt-1.5">
          Last render took {formatEta(lastRenderDurationMs)}
        </p>
      )}
    </div>
  );
}

export const RenderQueue = memo(function RenderQueue({
  jobs,
  projectId,
  onDelete,
  onCancel,
  onClearCompleted,
  onStartRender,
  isRendering,
  loadError,
  onRetryLoad,
  actionError,
  onDismissActionError,
  compositionDimensions,
}: RenderQueueProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new jobs are added.
  // Runs in an effect to avoid side effects during the render phase.
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [jobs.length]);

  const completedCount = jobs.filter((j) => j.status !== "rendering").length;
  const lastRenderDurationMs = [...jobs]
    .reverse()
    .find((j) => j.status === "complete" && j.durationMs !== undefined)?.durationMs;

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-3 border-b border-panel-border flex-shrink-0">
        <FormatExportButton
          onStartRender={onStartRender}
          isRendering={isRendering}
          compositionDimensions={compositionDimensions}
          lastRenderDurationMs={lastRenderDurationMs}
        />
      </div>

      {actionError && (
        <div
          role="alert"
          className="flex items-start justify-between gap-2 px-3 py-2 border-b border-panel-border bg-red-500/10"
        >
          <span className="text-[10px] text-red-400">{actionError}</span>
          {onDismissActionError && (
            <button
              onClick={onDismissActionError}
              aria-label="Dismiss error"
              className="text-[10px] text-panel-text-4 hover:text-panel-text-2 flex-shrink-0"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* Job list */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {loadError && jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4 gap-2" role="alert">
            <p className="text-[10px] text-red-400 text-center">{loadError}</p>
            {onRetryLoad && (
              <Button size="sm" variant="secondary" onClick={onRetryLoad}>
                Retry
              </Button>
            )}
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4 gap-2">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-panel-text-5"
            >
              <rect
                x="2"
                y="2"
                width="20"
                height="20"
                rx="2.18"
                ry="2.18"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <p className="text-[10px] text-panel-text-5 text-center">No renders yet</p>
          </div>
        ) : (
          <div>
            {completedCount > 0 && (
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-panel-border">
                <span className="text-[10px] text-panel-text-4">
                  {jobs.length} render{jobs.length === 1 ? "" : "s"}
                </span>
                {/* "Hide", not "Clear": files stay on disk (delete is per-row
                    and confirmed); hidden rows don't resurrect on reload. */}
                <button
                  onClick={onClearCompleted}
                  title="Hide finished renders from this list (files stay on disk)"
                  className="text-[10px] text-panel-text-4 hover:text-panel-text-2 transition-colors"
                >
                  Hide finished
                </button>
              </div>
            )}
            {jobs.map((job) => (
              <RenderQueueItem
                key={job.id}
                job={job}
                projectId={projectId}
                onDelete={() => onDelete(job.id)}
                onCancel={() => onCancel?.(job.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
