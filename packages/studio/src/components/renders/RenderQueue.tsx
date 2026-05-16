import { memo, useState, useRef, useEffect } from "react";
import { RenderQueueItem } from "./RenderQueueItem";
import type { RenderJob, ResolutionPreset } from "./useRenderQueue";
import { getPersistedRenderSettings, persistRenderSettings } from "./renderSettings";

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
  onClearCompleted: () => void;
  onStartRender: StartRenderHandler;
  isRendering: boolean;
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
  return resolved
    ? `${SCALE_LABEL[scale]} · ${resolved.width}×${resolved.height}`
    : SCALE_LABEL[scale];
}

const FORMAT_INFO: Record<"mp4" | "webm" | "mov", { label: string; desc: string }> = {
  mp4: { label: "MP4", desc: "Best for general use. Smallest file, universal playback." },
  mov: {
    label: "MOV (ProRes 4444)",
    desc: "Transparent video. Works in CapCut, Final Cut Pro, Premiere, DaVinci Resolve, After Effects. Large files.",
  },
  webm: {
    label: "WebM (VP9)",
    desc: "Transparent video for web. Smaller than MOV but limited editor support.",
  },
};

function FormatInfoTooltip({ format }: { format: "mp4" | "webm" | "mov" }) {
  const [open, setOpen] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = () => {
    clearTimeout(timeoutRef.current);
    setOpen(true);
  };
  const hide = () => {
    timeoutRef.current = setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  const info = FORMAT_INFO[format];

  return (
    <div className="relative" onPointerEnter={show} onPointerLeave={hide}>
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-neutral-600 hover:text-neutral-400 transition-colors cursor-help"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      {open && (
        <div className="absolute top-full right-0 mt-1.5 w-52 p-2 rounded bg-neutral-900 border border-neutral-700 shadow-lg z-50">
          <p className="text-[10px] font-semibold text-neutral-200 mb-0.5">{info.label}</p>
          <p className="text-[9px] text-neutral-400 leading-tight">{info.desc}</p>
          <div className="mt-1.5 pt-1.5 border-t border-neutral-800">
            {(["mp4", "mov", "webm"] as const)
              .filter((f) => f !== format)
              .map((f) => (
                <p key={f} className="text-[9px] text-neutral-500 leading-relaxed">
                  <span className="text-neutral-400 font-medium">{FORMAT_INFO[f].label}</span>
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

function FormatExportButton({
  onStartRender,
  isRendering,
  compositionDimensions,
}: {
  onStartRender: StartRenderHandler;
  isRendering: boolean;
  compositionDimensions?: CompositionDimensions | null;
}) {
  const persisted = getPersistedRenderSettings();
  const [format, setFormat] = useState<"mp4" | "webm" | "mov">(persisted.format);
  const [quality, setQuality] = useState<"draft" | "standard" | "high">(persisted.quality);
  const [resolution, setResolution] = useState<ResolutionPreset | "auto">("auto");
  const [fps, setFps] = useState<24 | 30 | 60>(persisted.fps);

  // MOV (ProRes) is a fixed-quality codec — quality selector has no effect.
  const showQuality = format !== "mov";

  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      <FormatInfoTooltip format={format} />
      {/* Resolution must remain the leftmost <select> in this row — it
          carries `rounded-l` for the joined-button look. If you ever hide it
          (feature-flag, etc.), move `rounded-l` to whichever element ends up
          leftmost. */}
      <select
        value={resolution}
        onChange={(e) => setResolution(e.target.value as ResolutionPreset | "auto")}
        disabled={isRendering}
        className="h-5 px-1 text-[10px] rounded-l bg-neutral-800 border border-neutral-700 text-neutral-300 outline-none disabled:opacity-50"
      >
        {SCALE_OPTION_ORDER.map((value) => (
          <option key={value} value={value} disabled={!scaleApplies(value, compositionDimensions)}>
            {scaleOptionLabel(value, compositionDimensions)}
          </option>
        ))}
      </select>
      {showQuality && (
        <select
          value={quality}
          onChange={(e) => {
            const v = e.target.value as "draft" | "standard" | "high";
            setQuality(v);
            persistRenderSettings(format, v, fps);
          }}
          disabled={isRendering}
          title={QUALITY_OPTIONS.find((q) => q.value === quality)?.title}
          className="h-5 px-1 text-[10px] bg-neutral-800 border border-neutral-700 text-neutral-300 outline-none disabled:opacity-50"
        >
          {QUALITY_OPTIONS.map((q) => (
            <option key={q.value} value={q.value} title={q.title}>
              {q.label}
            </option>
          ))}
        </select>
      )}
      <select
        value={fps}
        onChange={(e) => {
          const v = Number(e.target.value) as 24 | 30 | 60;
          setFps(v);
          persistRenderSettings(format, quality, v);
        }}
        disabled={isRendering}
        title="Frames per second"
        className="h-5 px-1 text-[10px] bg-neutral-800 border border-neutral-700 text-neutral-300 outline-none disabled:opacity-50"
      >
        <option value={24}>24fps</option>
        <option value={30}>30fps</option>
        <option value={60}>60fps</option>
      </select>
      <select
        value={format}
        onChange={(e) => {
          const v = e.target.value as "mp4" | "webm" | "mov";
          setFormat(v);
          persistRenderSettings(v, quality, fps);
        }}
        disabled={isRendering}
        className="h-5 px-1 text-[10px] bg-neutral-800 border border-neutral-700 text-neutral-300 outline-none disabled:opacity-50"
      >
        <option value="mp4">MP4</option>
        <option value="mov">MOV</option>
        <option value="webm">WebM</option>
      </select>
      <button
        onClick={() => {
          void onStartRender(format, quality, resolution, fps);
        }}
        disabled={isRendering}
        className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-r bg-studio-accent text-[#09090B] hover:brightness-110 transition-colors disabled:opacity-50"
      >
        {isRendering ? "Rendering..." : "Export"}
      </button>
    </div>
  );
}

export const RenderQueue = memo(function RenderQueue({
  jobs,
  projectId,
  onDelete,
  onClearCompleted,
  onStartRender,
  isRendering,
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

  return (
    <div className="flex flex-col h-full">
      {/* Header — no title, already shown in header button */}
      <div className="flex items-center justify-end flex-wrap gap-y-1.5 px-3 py-2 border-b border-neutral-800/50 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          {completedCount > 0 && (
            <button
              onClick={onClearCompleted}
              className="text-[10px] text-neutral-600 hover:text-neutral-400 transition-colors"
            >
              Clear
            </button>
          )}
          <FormatExportButton
            onStartRender={onStartRender}
            isRendering={isRendering}
            compositionDimensions={compositionDimensions}
          />
        </div>
      </div>

      {/* Job list */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4 gap-2">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-neutral-700"
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
            <p className="text-[10px] text-neutral-600 text-center">No renders yet</p>
          </div>
        ) : (
          jobs.map((job) => (
            <RenderQueueItem
              key={job.id}
              job={job}
              projectId={projectId}
              onDelete={() => onDelete(job.id)}
            />
          ))
        )}
      </div>
    </div>
  );
});
