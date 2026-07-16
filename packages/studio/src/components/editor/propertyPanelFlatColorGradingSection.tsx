import { useEffect, useMemo, useRef, useState } from "react";
import {
  HF_COLOR_GRADING_PRESETS,
  isHfColorGradingActive,
  normalizeHfColorGrading,
  type HfColorGradingAdjustKey,
  type HfColorGradingDetailKey,
  type HfColorGradingEffectKey,
  type NormalizedHfColorGrading,
} from "@hyperframes/core/color-grading";
import { Compare, Plus, RotateCcw, Settings } from "../../icons/SystemIcons";
import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";
import { LUT_EXT } from "../../utils/mediaTypes";
import { FlatSelectRow, FlatSlider } from "./propertyPanelFlatPrimitives";
import { resolveValueTier } from "./propertyPanelValueTier";
import type { ColorGradingControllerState, MediaMetadata } from "./useColorGradingController";

const STATUS_DOT_CLASS: Record<ColorGradingControllerState["runtimeStatus"]["state"], string> = {
  active: "bg-emerald-400",
  pending: "bg-amber-300",
  unavailable: "bg-red-400",
  missing: "bg-panel-text-5",
  inactive: "bg-panel-text-5",
};

export function FlatColorGradingAccessory({
  state,
}: {
  state: Pick<
    ColorGradingControllerState,
    "grading" | "compareEnabled" | "runtimeStatus" | "commitCompare" | "resetGrading"
  >;
}) {
  const track = useTrackDesignInput();
  const { grading, compareEnabled, runtimeStatus, commitCompare, resetGrading } = state;
  const gradingActive = isHfColorGradingActive(grading);
  // Tracks the active hold's cleanup so it can be torn down on unmount too —
  // without this, switching selection away mid-hold (unmounting this
  // accessory) leaves the pointerup/pointercancel/blur listeners registered
  // on `window` forever, each holding a closure over the old commitCompare.
  const releaseRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      releaseRef.current?.();
      releaseRef.current = null;
    },
    [],
  );

  return (
    <span className="flex items-center gap-2.5">
      <button
        type="button"
        aria-pressed={compareEnabled}
        aria-label="Hold to show original"
        disabled={!gradingActive}
        onPointerDown={(e) => {
          if (!gradingActive) return;
          e.preventDefault();
          e.stopPropagation();
          track("button", "Compare original");
          commitCompare(true);
          const release = () => {
            commitCompare(false);
            window.removeEventListener("pointerup", release);
            window.removeEventListener("pointercancel", release);
            window.removeEventListener("blur", release);
            releaseRef.current = null;
          };
          releaseRef.current = release;
          window.addEventListener("pointerup", release);
          window.addEventListener("pointercancel", release);
          window.addEventListener("blur", release);
        }}
        onBlur={() => {
          if (compareEnabled) commitCompare(false);
        }}
        onKeyDown={(e) => {
          if (!gradingActive || (e.key !== " " && e.key !== "Enter")) return;
          e.preventDefault();
          if (!compareEnabled) {
            track("button", "Compare original");
            commitCompare(true);
          }
        }}
        onKeyUp={(e) => {
          if (!gradingActive || (e.key !== " " && e.key !== "Enter")) return;
          e.preventDefault();
          commitCompare(false);
        }}
        title="Hold to show original"
        className="flex-shrink-0 text-panel-text-3 hover:text-panel-text-1 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Compare size={12} />
      </button>
      <span className="flex min-w-0 items-center gap-1" title={runtimeStatus.message}>
        <span
          data-flat-grade-status-dot="true"
          title={runtimeStatus.message}
          className={`h-[5px] w-[5px] flex-shrink-0 rounded-full ${STATUS_DOT_CLASS[runtimeStatus.state]}`}
        />
        <span
          data-flat-grade-status-message="true"
          className="max-w-[84px] truncate text-[9px] text-panel-text-4"
        >
          {runtimeStatus.message}
        </span>
      </span>
      <button
        type="button"
        data-flat-grade-reset="true"
        title="Reset color grading"
        onClick={(e) => {
          e.stopPropagation();
          track("button", "Reset color grading");
          resetGrading();
        }}
        className="flex-shrink-0 text-panel-text-3 hover:text-panel-text-1"
      >
        <RotateCcw size={12} />
      </button>
    </span>
  );
}

const PRESET_OPTIONS = HF_COLOR_GRADING_PRESETS.map((p) => ({ value: p.id, label: p.label }));

const ADJUST_SLIDERS: Array<{
  key: HfColorGradingAdjustKey;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: "exposure", label: "Exposure", min: -200, max: 200, step: 5 },
  { key: "contrast", label: "Contrast", min: -100, max: 100, step: 1 },
  { key: "highlights", label: "Highlights", min: -100, max: 100, step: 1 },
  { key: "shadows", label: "Shadows", min: -100, max: 100, step: 1 },
  { key: "whites", label: "White Point", min: -100, max: 100, step: 1 },
  { key: "blacks", label: "Black Point", min: -100, max: 100, step: 1 },
  { key: "temperature", label: "Warmth", min: -100, max: 100, step: 1 },
  { key: "tint", label: "Tint", min: -100, max: 100, step: 1 },
  { key: "vibrance", label: "Vibrance", min: -100, max: 100, step: 1 },
  { key: "saturation", label: "Saturation", min: -100, max: 100, step: 1 },
];

function visibleIntensity(grading: NormalizedHfColorGrading): number {
  // Earlier drafts could persist 0% strength; the next manual edit should revive visible grading.
  return grading.intensity === 0 ? 1 : grading.intensity;
}

function formatAdjustValue(key: HfColorGradingAdjustKey, rawPercent: number): string {
  if (key === "exposure") {
    const stops = rawPercent / 100;
    return `${stops >= 0 ? "+" : ""}${stops.toFixed(2)}`;
  }
  return `${Math.round(rawPercent)}%`;
}

const DETAIL_SLIDERS: Array<{
  key: HfColorGradingDetailKey;
  label: string;
  defaultValue: number;
}> = [
  { key: "vignette", label: "Vignette", defaultValue: 0 },
  { key: "vignetteMidpoint", label: "Midpoint", defaultValue: 0.5 },
  { key: "vignetteRoundness", label: "Roundness", defaultValue: 0 },
  { key: "vignetteFeather", label: "Feather", defaultValue: 0.65 },
  { key: "grain", label: "Grain", defaultValue: 0 },
  { key: "grainSize", label: "Grain Size", defaultValue: 0.25 },
  { key: "grainRoughness", label: "Roughness", defaultValue: 0.5 },
];
const detailByKey = (key: HfColorGradingDetailKey) => {
  const spec = DETAIL_SLIDERS.find((d) => d.key === key);
  if (!spec) throw new Error(`Unknown color grading detail key: ${key}`);
  return spec;
};
const VIGNETTE_TUNE_KEYS: HfColorGradingDetailKey[] = [
  "vignetteMidpoint",
  "vignetteRoundness",
  "vignetteFeather",
];
const GRAIN_TUNE_KEYS: HfColorGradingDetailKey[] = ["grainSize", "grainRoughness"];

const EFFECT_SLIDERS: Array<{ key: HfColorGradingEffectKey; label: string }> = [
  { key: "blur", label: "Blur" },
  { key: "pixelate", label: "Pixelate" },
];

function HdrBanner({ metadata }: { metadata: MediaMetadata | null }) {
  if (metadata?.color.dynamicRange !== "hdr") return null;
  const details = [
    metadata.color.codecName,
    metadata.color.profile,
    metadata.color.pixelFormat,
    metadata.color.colorPrimaries,
    metadata.color.colorTransfer,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      data-flat-grade-hdr-banner="true"
      className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-4 text-amber-100"
    >
      <div className="mb-0.5 flex items-center justify-between gap-2">
        <span className="font-semibold">{metadata.color.label} source</span>
        <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-100">
          SDR preview
        </span>
      </div>
      <p className="text-amber-100/80">
        These controls use the current SDR shader preview path. Render may stay HDR-tagged, but this
        is not true HDR color grading yet.
      </p>
      {details && (
        <p
          data-flat-grade-hdr-detail="true"
          className="mt-0.5 truncate text-[9px] text-amber-100/55"
        >
          {details}
        </p>
      )}
    </div>
  );
}

// fallow-ignore-next-line complexity
export function FlatColorGradingSection({
  grading,
  assets,
  onImportAssets,
  onCommitColorGrading,
  applyScope,
  applyBusy,
  onSetApplyScope,
  onApplyToScope,
  onApplyScopeAvailable,
  mediaMetadata,
}: {
  grading: NormalizedHfColorGrading;
  assets: string[];
  onImportAssets?: (files: FileList, dir?: string) => Promise<string[]>;
  onCommitColorGrading: (next: NormalizedHfColorGrading) => void;
  applyScope: "source-file" | "project";
  applyBusy: boolean;
  onSetApplyScope: (scope: "source-file" | "project") => void;
  onApplyToScope: () => void;
  onApplyScopeAvailable: boolean;
  mediaMetadata: MediaMetadata | null;
}) {
  const track = useTrackDesignInput();
  const lutInputRef = useRef<HTMLInputElement>(null);
  const [lutOpen, setLutOpen] = useState(false);
  const [detailSettingsOpen, setDetailSettingsOpen] = useState<"vignette" | "grain" | null>(null);
  const lutAssets = useMemo(
    () => assets.filter((asset) => LUT_EXT.test(asset)).sort((a, b) => a.localeCompare(b)),
    [assets],
  );
  const lut = grading.lut;
  const selectedLutName = lut?.src ? (lut.src.split("/").pop() ?? lut.src) : null;

  const applyPreset = (presetId: string) => {
    const next = normalizeHfColorGrading({ preset: presetId, intensity: 1, lut: grading.lut });
    if (next) onCommitColorGrading(next);
  };
  const updateIntensity = (value: number) => {
    onCommitColorGrading({ ...grading, intensity: value / 100 });
  };
  const applyLut = (src: string | null, intensity = 1) => {
    onCommitColorGrading({
      ...grading,
      intensity: visibleIntensity(grading),
      lut: src ? { src, intensity } : null,
    });
  };
  const importLuts = async (files: FileList | null) => {
    if (!files?.length || !onImportAssets) return;
    const uploaded = await onImportAssets(files, "assets/luts");
    const firstLut = uploaded.find((asset) => LUT_EXT.test(asset));
    if (firstLut) {
      track("button", "Import LUT");
      applyLut(firstLut, 1);
    }
  };

  const renderDetailSlider = (key: HfColorGradingDetailKey) => {
    const spec = detailByKey(key);
    const value = grading.details[key];
    const isSet = Math.abs(value - spec.defaultValue) > 1e-4;
    return (
      <FlatSlider
        key={key}
        label={spec.label}
        value={Math.round(value * 100)}
        min={key === "vignetteRoundness" ? -100 : 0}
        max={100}
        tier={isSet ? "explicitCustom" : "default"}
        displayValue={`${Math.round(value * 100)}%`}
        centerTick={key === "vignetteRoundness"}
        onCommit={(next) =>
          onCommitColorGrading({
            ...grading,
            intensity: visibleIntensity(grading),
            details: { ...grading.details, [key]: next / 100 },
          })
        }
        onReset={() =>
          onCommitColorGrading({
            ...grading,
            intensity: visibleIntensity(grading),
            details: { ...grading.details, [key]: spec.defaultValue },
          })
        }
      />
    );
  };

  return (
    <div className="space-y-1.5">
      <HdrBanner metadata={mediaMetadata} />
      <div data-flat-grade-preset="true" className="flex min-h-[30px] items-center justify-between">
        <span className="text-[11px] text-panel-text-2">Preset</span>
        <FlatSelectRow
          label=""
          ariaLabel="Preset"
          value={grading.preset ?? "neutral"}
          options={PRESET_OPTIONS}
          tier={resolveValueTier(
            grading.preset === "neutral" ? undefined : (grading.preset ?? undefined),
            "neutral",
          )}
          onChange={applyPreset}
        />
      </div>
      <FlatSlider
        label="Strength"
        value={Math.round(grading.intensity * 100)}
        min={0}
        max={100}
        tier={grading.intensity === 1 ? "default" : "explicitCustom"}
        displayValue={`${Math.round(grading.intensity * 100)}%`}
        onCommit={updateIntensity}
        onReset={() => updateIntensity(100)}
      />

      <div className="border-t border-panel-hairline pt-1.5">
        <button
          type="button"
          data-flat-grade-lut-toggle="true"
          onClick={() => setLutOpen((v) => !v)}
          className="flex min-h-[30px] w-full items-center justify-between text-left"
        >
          <span className="text-[11px] text-panel-text-2">Custom LUT</span>
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="currentColor"
            className={`flex-shrink-0 text-panel-text-5 transition-transform ${lutOpen ? "rotate-90" : ""}`}
          >
            <path d="M2 3l3 4 3-4z" />
          </svg>
        </button>
        {lutOpen && (
          <div className="space-y-1.5 pb-1">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-panel-text-3">
                {selectedLutName ?? "None"}
              </span>
              <select
                data-flat-grade-lut-select="true"
                aria-label="Custom LUT"
                value={lut?.src ?? ""}
                onChange={(e) => {
                  const src = e.target.value;
                  track("select", "Custom LUT");
                  applyLut(src || null, src && lut?.src === src ? lut.intensity : 1);
                }}
                className="border-b border-panel-border-input/50 bg-transparent font-mono text-[10px] text-panel-text-3 outline-none hover:border-panel-border-input"
              >
                <option value="">None</option>
                {lutAssets.map((asset) => (
                  <option key={asset} value={asset}>
                    {asset.split("/").pop() ?? asset}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!onImportAssets}
                onClick={() => lutInputRef.current?.click()}
                title="Import .cube LUT"
                className="flex-shrink-0 text-panel-text-4 hover:text-panel-text-1 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus size={12} />
              </button>
              <input
                ref={lutInputRef}
                type="file"
                accept=".cube"
                className="hidden"
                onChange={(e) => {
                  void importLuts(e.currentTarget.files);
                  e.currentTarget.value = "";
                }}
              />
            </div>
            {lut && (
              <FlatSlider
                label="LUT strength"
                value={Math.round((lut.intensity ?? 1) * 100)}
                min={0}
                max={100}
                tier={lut.intensity === 1 ? "default" : "explicitCustom"}
                displayValue={`${Math.round((lut.intensity ?? 1) * 100)}%`}
                onCommit={(v) => applyLut(lut.src, v / 100)}
                onReset={() => applyLut(lut.src, 1)}
              />
            )}
          </div>
        )}
      </div>

      <div className="space-y-0.5 border-t border-panel-hairline pt-1.5">
        <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-panel-text-5">
          Adjust
        </div>
        {ADJUST_SLIDERS.map((slider) => {
          const rawPercent = grading.adjust[slider.key] * 100;
          const isSet = Math.abs(grading.adjust[slider.key]) > 1e-6;
          return (
            <div key={slider.key} data-flat-grade-adjust="true">
              <FlatSlider
                label={slider.label}
                value={rawPercent}
                min={slider.min}
                max={slider.max}
                step={slider.step}
                tier={isSet ? "explicitCustom" : "default"}
                displayValue={formatAdjustValue(slider.key, rawPercent)}
                centerTick
                onCommit={(next) =>
                  onCommitColorGrading({
                    ...grading,
                    intensity: visibleIntensity(grading),
                    adjust: { ...grading.adjust, [slider.key]: next / 100 },
                  })
                }
                onReset={() =>
                  onCommitColorGrading({
                    ...grading,
                    intensity: visibleIntensity(grading),
                    adjust: { ...grading.adjust, [slider.key]: 0 },
                  })
                }
              />
            </div>
          );
        })}
      </div>

      <div className="space-y-1.5 border-t border-panel-hairline pt-1.5">
        <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-panel-text-5">
          Finishing
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex-1">{renderDetailSlider("vignette")}</div>
          <button
            type="button"
            data-flat-grade-settings="vignette"
            title="Vignette settings"
            onClick={() => setDetailSettingsOpen((c) => (c === "vignette" ? null : "vignette"))}
            className="flex-shrink-0 text-panel-text-4 hover:text-panel-text-1"
          >
            <Settings size={12} />
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex-1">{renderDetailSlider("grain")}</div>
          <button
            type="button"
            data-flat-grade-settings="grain"
            title="Grain settings"
            onClick={() => setDetailSettingsOpen((c) => (c === "grain" ? null : "grain"))}
            className="flex-shrink-0 text-panel-text-4 hover:text-panel-text-1"
          >
            <Settings size={12} />
          </button>
        </div>
        {detailSettingsOpen && (
          <div className="space-y-0.5 border-l-2 border-panel-border-input pl-2.5">
            {(detailSettingsOpen === "vignette" ? VIGNETTE_TUNE_KEYS : GRAIN_TUNE_KEYS).map(
              renderDetailSlider,
            )}
          </div>
        )}
      </div>

      <div className="space-y-0.5 border-t border-panel-hairline pt-1.5">
        <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-panel-text-5">
          Effects
        </div>
        {EFFECT_SLIDERS.map((slider) => {
          const value = grading.effects[slider.key];
          const isSet = value > 1e-6;
          return (
            <div key={slider.key} data-flat-grade-effect="true">
              <FlatSlider
                label={slider.label}
                value={Math.round(value * 100)}
                min={0}
                max={100}
                tier={isSet ? "explicitCustom" : "default"}
                displayValue={`${Math.round(value * 100)}%`}
                onCommit={(next) =>
                  onCommitColorGrading({
                    ...grading,
                    intensity: visibleIntensity(grading),
                    effects: { ...grading.effects, [slider.key]: next / 100 },
                  })
                }
                onReset={() =>
                  onCommitColorGrading({
                    ...grading,
                    intensity: visibleIntensity(grading),
                    effects: { ...grading.effects, [slider.key]: 0 },
                  })
                }
              />
            </div>
          );
        })}
      </div>

      {onApplyScopeAvailable && (
        <div className="flex items-center justify-between gap-2 border-t border-panel-hairline pt-1.5">
          <span className="flex items-center gap-1.5 text-[11px] text-panel-text-2">
            Copy grade to
            <select
              aria-label="Copy grade to"
              value={applyScope}
              onChange={(e) => {
                track("select", "Copy grade scope");
                onSetApplyScope(e.target.value as "source-file" | "project");
              }}
              disabled={applyBusy}
              className="border-b border-panel-border-input/50 bg-transparent font-mono text-[11px] text-panel-text-0 outline-none hover:border-panel-border-input disabled:opacity-50"
            >
              <option value="source-file">Current file media</option>
              <option value="project">All project media</option>
            </select>
          </span>
          <button
            type="button"
            data-flat-grade-apply="true"
            disabled={applyBusy}
            onClick={() => {
              track("button", "Apply grade to scope");
              onApplyToScope();
            }}
            className="text-[11px] font-medium text-panel-accent hover:text-panel-accent/80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {applyBusy ? "Applying" : "Apply"}
          </button>
        </div>
      )}
    </div>
  );
}
