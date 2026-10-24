import { useState, useRef, useEffect, useLayoutEffect, useId } from "react";
import { createPortal } from "react-dom";
import { CANVAS_DIMENSIONS } from "@hyperframes/parsers";
import { FfmpegRequiredNotice } from "./FfmpegRequiredNotice";
import type { FfmpegStatus } from "./useFfmpegStatus";
import { Button } from "../ui/Button";
import { Select, type SelectOption } from "../ui/Select";
import { resolveFloatingPanelPosition, type FloatingPosition } from "../editor/floatingPanel";
import type { ResolutionPreset } from "./useRenderQueue";
import type { CompositionDimensions, StartRenderHandler } from "./RenderQueue";
import {
  getRenderSettings,
  normalizeRenderSettings,
  updatePersistedRenderSettings,
  type RenderSettings,
} from "./renderSettings";
import { GpuEncodingToggle } from "./GpuEncodingToggle";
import { AdvancedRenderSettings } from "./AdvancedRenderSettings";
import { trackStudioEvent } from "../../utils/studioTelemetry";

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
    return `${base} (not an integer scale of ${dims.width}×${dims.height})`;
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

// Estimated, like COLOR_PICKER_SIZE in propertyPanelColor: only the flip
// decision uses the height, and the clamp keeps the panel on screen either way.
const FORMAT_PANEL_SIZE = { width: 208, height: 150 };

// Rich format guidance in a keyboard-reachable disclosure: the trigger is a
// real button (focusable, labelled), the panel is tied to it via
// aria-describedby, and Escape dismisses (WCAG 1.4.13). Content is too rich
// for the one-line ui/Tooltip primitive, so this stays a local popover.
// It renders in a portal because the right panel is overflow-hidden: an
// in-flow absolute panel gets clipped at the panel edge.
function FormatInfoTooltip({ format }: { format: "mp4" | "webm" | "mov" }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<FloatingPosition | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
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

  // Positioned once on open, so it does not follow panel scroll. The popover
  // is hover-lived; add a scroll listener only if that ever shows up.
  useLayoutEffect(() => {
    if (!open) return;
    const el = triggerRef.current;
    if (!el) return;
    setPosition(
      resolveFloatingPanelPosition(
        el.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
        FORMAT_PANEL_SIZE,
        { offset: 6 },
      ),
    );
  }, [open]);

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
    <div ref={triggerRef} className="relative" onPointerEnter={show} onPointerLeave={hide}>
      <button
        type="button"
        aria-label="About video formats"
        aria-expanded={open}
        aria-describedby={open ? panelId : undefined}
        onFocus={show}
        onBlur={hide}
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center justify-center p-0.5 -m-0.5 rounded-sm text-text-5 hover:text-text-3 transition-colors cursor-help outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent"
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
      {open &&
        createPortal(
          <div
            id={panelId}
            role="tooltip"
            onPointerEnter={show}
            onPointerLeave={hide}
            className="fixed w-52 p-2 rounded-sm bg-input border border-border-input shadow-menu z-200"
            style={{ left: position?.left ?? -9999, top: position?.top ?? -9999 }}
          >
            <p className="text-step-10 font-semibold text-text-1 mb-0.5">{info.label}</p>
            <p className="text-step-9 text-text-3 leading-tight">{info.desc}</p>
            <div className="mt-1.5 pt-1.5 border-t border-border">
              {(["mp4", "mov", "webm"] as const)
                .filter((f) => f !== format)
                .map((f) => (
                  <p key={f} className="text-step-9 text-text-4 leading-relaxed">
                    <span className="text-text-3 font-medium">{FORMAT_INFO[f].label}</span>
                    {": "}
                    {FORMAT_INFO[f].desc}
                  </p>
                ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

const FORMAT_OPTIONS: SelectOption[] = [
  { value: "mp4", label: "MP4" },
  { value: "mov", label: "MOV (ProRes)" },
  { value: "webm", label: "WebM" },
];

const QUALITY_OPTIONS: SelectOption[] = [
  { value: "draft", label: "Draft" },
  { value: "standard", label: "Standard" },
  { value: "high", label: "High Quality" },
];

const FPS_OPTIONS: SelectOption[] = [
  { value: "24", label: "24 fps" },
  { value: "30", label: "30 fps" },
  { value: "60", label: "60 fps" },
];

function missingFfmpegStatus(status: FfmpegStatus | null): FfmpegStatus | null {
  return status && !status.ok ? status : null;
}

function formatEta(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function RenderExportSettings({
  onStartRender,
  isRendering,
  compositionDimensions,
  lastRenderDurationMs,
  ffmpeg,
  ffmpegChecking,
  onRecheckFfmpeg,
}: {
  onStartRender: StartRenderHandler;
  isRendering: boolean;
  compositionDimensions?: CompositionDimensions | null;
  lastRenderDurationMs?: number;
  ffmpeg: FfmpegStatus | null;
  ffmpegChecking: boolean;
  onRecheckFfmpeg: () => void;
}) {
  const [settings, setSettings] = useState(getRenderSettings);
  const [resolution, setResolution] = useState<RenderScale>("auto");
  const [invalidDraft, setInvalidDraft] = useState(false);
  const [rateNotice, setRateNotice] = useState<string | null>(null);
  const { format, quality, fps, gpu } = settings;

  const commit = (patch: Partial<RenderSettings>) => {
    const next = normalizeRenderSettings({ ...settings, ...patch });
    if (patch.format && settings.rateControl.mode !== "auto" && next.rateControl.mode === "auto") {
      setRateNotice(
        "Custom rate control cleared because it is unavailable for the selected format.",
      );
    } else {
      setRateNotice(null);
    }
    setSettings(updatePersistedRenderSettings(next));
  };

  // Only a definite "not installed" blocks Export. A null status means the
  // probe gave no answer, and refusing to export on no answer would break
  // setups that are perfectly fine. Holding the narrowed value rather than a
  // boolean keeps the notice from re-testing what this line already decided.
  const missingFfmpeg = missingFfmpegStatus(ffmpeg);

  // MOV (ProRes) is a fixed-quality codec — quality selector has no effect.
  const showQuality = format !== "mov";

  return (
    <div className="flex flex-col gap-3">
      {missingFfmpeg && (
        <FfmpegRequiredNotice
          status={missingFfmpeg}
          checking={ffmpegChecking}
          onRecheck={onRecheckFfmpeg}
        />
      )}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <span className="text-step-10 text-text-4">Format</span>
            <FormatInfoTooltip format={format} />
          </div>
          <Select
            label="Format"
            value={format}
            options={FORMAT_OPTIONS}
            disabled={isRendering}
            onCommit={(next) => {
              if (next === "mp4" || next === "webm" || next === "mov") commit({ format: next });
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-step-10 text-text-4">Resolution</span>
          <Select
            label="Resolution"
            value={resolution}
            options={SCALE_OPTION_ORDER.map((value) => ({
              value,
              label: scaleOptionLabel(value, compositionDimensions),
              disabled: !scaleApplies(value, compositionDimensions),
            }))}
            disabled={isRendering}
            onCommit={(next) => {
              if (next === "auto" || next === "1080p" || next === "4k") setResolution(next);
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-step-10 text-text-4">Frame rate</span>
          <Select
            label="Frame rate"
            value={String(fps)}
            options={FPS_OPTIONS}
            disabled={isRendering}
            onCommit={(next) => {
              const value = Number(next);
              if (value === 24 || value === 30 || value === 60) commit({ fps: value });
            }}
          />
        </div>
        {showQuality && (
          <div className="flex flex-col gap-1">
            <span className="text-step-10 text-text-4">Quality</span>
            <Select
              label="Quality"
              value={quality}
              options={QUALITY_OPTIONS}
              disabled={isRendering}
              onCommit={(next) => {
                if (next === "draft" || next === "standard" || next === "high")
                  commit({ quality: next });
              }}
            />
          </div>
        )}
      </div>
      <GpuEncodingToggle
        format={format}
        checked={gpu}
        disabled={isRendering}
        onToggle={() => commit({ gpu: !gpu })}
      />
      {rateNotice && (
        <p role="status" className="text-step-9 text-text-4">
          {rateNotice}
        </p>
      )}
      <AdvancedRenderSettings
        settings={settings}
        disabled={isRendering}
        onChange={commit}
        onValidityChange={setInvalidDraft}
      />
      <Button
        variant="primary"
        size="md"
        data-testid="renders-export"
        loading={isRendering}
        disabled={missingFfmpeg !== null || invalidDraft}
        title={missingFfmpeg ? "Install FFmpeg to export. See the note above." : undefined}
        onClick={() => {
          // loading already disables the button; this guard also stops a
          // double-click in the same frame from enqueueing two renders.
          if (isRendering || missingFfmpeg || invalidDraft) return;
          const outputResolution = resolveResolution(resolution, compositionDimensions);
          trackStudioEvent("render_start", { format, quality, resolution: outputResolution, fps });
          const { rateControl, videoFrameFormat, hdrMode } = settings;
          if (rateControl.mode === "auto" && videoFrameFormat === "auto" && hdrMode === "auto") {
            void onStartRender(format, quality, outputResolution, fps, gpu);
          } else {
            void onStartRender(format, quality, outputResolution, fps, gpu, {
              rateControl,
              videoFrameFormat,
              hdrMode,
            });
          }
        }}
        // Width only: the size recipe keeps this Export consistent with the header.
        className="w-full"
      >
        {isRendering ? "Rendering…" : "Export"}
      </Button>
      {lastRenderDurationMs !== undefined && !isRendering && (
        <p className="text-step-9 text-text-5 text-center -mt-1.5">
          Last render took {formatEta(lastRenderDurationMs)}
        </p>
      )}
    </div>
  );
}
