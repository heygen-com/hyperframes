import { useMemo, useRef, useState } from "react";
import {
  HF_COLOR_GRADING_PRESETS,
  normalizeHfColorGrading,
  type HfColorGradingAdjustKey,
  type HfColorGradingDetailKey,
  type HfColorGradingEffectKey,
  type NormalizedHfColorGrading,
} from "@hyperframes/core/color-grading";
import { ChevronDown, ChevronRight, Plus, X } from "../../icons/SystemIcons";
import { LUT_EXT } from "../../utils/mediaTypes";
import { LABEL } from "./propertyPanelHelpers";
import { ColorGradingSliderControl } from "./propertyPanelColorGradingSlider";

const LUT_UPLOAD_DIR = "assets/luts";

const ADJUST_SLIDERS: Array<{
  key: HfColorGradingAdjustKey;
  label: string;
  min: number;
  max: number;
  step: number;
  scale: number;
  suffix: string;
}> = [
  { key: "exposure", label: "Exposure", min: -200, max: 200, step: 5, scale: 100, suffix: "" },
  { key: "contrast", label: "Contrast", min: -100, max: 100, step: 1, scale: 100, suffix: "%" },
  {
    key: "highlights",
    label: "Highlights",
    min: -100,
    max: 100,
    step: 1,
    scale: 100,
    suffix: "%",
  },
  { key: "shadows", label: "Shadows", min: -100, max: 100, step: 1, scale: 100, suffix: "%" },
  {
    key: "whites",
    label: "White Point",
    min: -100,
    max: 100,
    step: 1,
    scale: 100,
    suffix: "%",
  },
  {
    key: "blacks",
    label: "Black Point",
    min: -100,
    max: 100,
    step: 1,
    scale: 100,
    suffix: "%",
  },
  { key: "temperature", label: "Warmth", min: -100, max: 100, step: 1, scale: 100, suffix: "%" },
  { key: "tint", label: "Tint", min: -100, max: 100, step: 1, scale: 100, suffix: "%" },
  { key: "vibrance", label: "Vibrance", min: -100, max: 100, step: 1, scale: 100, suffix: "%" },
  { key: "saturation", label: "Saturation", min: -100, max: 100, step: 1, scale: 100, suffix: "%" },
];

const DETAIL_SLIDERS: Array<{
  key: HfColorGradingDetailKey;
  label: string;
  min: number;
  max: number;
  step: number;
  scale: number;
  suffix: string;
  defaultValue?: number;
}> = [
  { key: "vignette", label: "Vignette", min: 0, max: 100, step: 1, scale: 100, suffix: "%" },
  {
    key: "vignetteMidpoint",
    label: "Midpoint",
    min: 0,
    max: 100,
    step: 1,
    scale: 100,
    suffix: "%",
    defaultValue: 50,
  },
  {
    key: "vignetteRoundness",
    label: "Roundness",
    min: -100,
    max: 100,
    step: 1,
    scale: 100,
    suffix: "%",
  },
  {
    key: "vignetteFeather",
    label: "Feather",
    min: 0,
    max: 100,
    step: 1,
    scale: 100,
    suffix: "%",
    defaultValue: 65,
  },
  { key: "grain", label: "Grain", min: 0, max: 100, step: 1, scale: 100, suffix: "%" },
  {
    key: "grainSize",
    label: "Grain Size",
    min: 0,
    max: 100,
    step: 1,
    scale: 100,
    suffix: "%",
    defaultValue: 25,
  },
  {
    key: "grainRoughness",
    label: "Roughness",
    min: 0,
    max: 100,
    step: 1,
    scale: 100,
    suffix: "%",
    defaultValue: 50,
  },
];

type DetailSlider = (typeof DETAIL_SLIDERS)[number];
type SliderSettings = {
  active?: boolean;
  label: string;
  onClick: () => void;
};

const EFFECT_SLIDERS: Array<{
  key: HfColorGradingEffectKey;
  label: string;
  min: number;
  max: number;
  step: number;
  scale: number;
  suffix: string;
}> = [
  { key: "blur", label: "Blur", min: 0, max: 100, step: 1, scale: 100, suffix: "%" },
  { key: "pixelate", label: "Pixelate", min: 0, max: 100, step: 1, scale: 100, suffix: "%" },
];

const AMOUNT_DETAIL_SLIDERS = DETAIL_SLIDERS.filter(
  (slider) => slider.key === "vignette" || slider.key === "grain",
);
const VIGNETTE_TUNE_SLIDERS = DETAIL_SLIDERS.filter(
  (slider) =>
    slider.key === "vignetteMidpoint" ||
    slider.key === "vignetteRoundness" ||
    slider.key === "vignetteFeather",
);
const GRAIN_TUNE_SLIDERS = DETAIL_SLIDERS.filter(
  (slider) => slider.key === "grainSize" || slider.key === "grainRoughness",
);

function normalizedDefaultValue(slider: { defaultValue?: number; scale: number }): number {
  return (slider.defaultValue ?? 0) / slider.scale;
}

function visibleIntensity(grading: NormalizedHfColorGrading): number {
  // Earlier drafts could persist 0% strength; the next manual edit should revive visible grading.
  return grading.intensity === 0 ? 1 : grading.intensity;
}

export function ColorGradingControls({
  grading,
  assets,
  onImportAssets,
  onCommitColorGrading,
}: {
  grading: NormalizedHfColorGrading;
  assets: string[];
  onImportAssets?: (files: FileList, dir?: string) => Promise<string[]>;
  onCommitColorGrading: (nextGrading: NormalizedHfColorGrading) => void;
}) {
  const lutInputRef = useRef<HTMLInputElement>(null);
  const [lutOpen, setLutOpen] = useState(false);
  const [detailSettings, setDetailSettings] = useState<"vignette" | "grain" | null>(null);
  const lutAssets = useMemo(
    () => assets.filter((asset) => LUT_EXT.test(asset)).sort((a, b) => a.localeCompare(b)),
    [assets],
  );
  const selectedLut = grading.lut?.src ?? "";
  const selectedProjectLut = selectedLut ? (selectedLut.split("/").pop() ?? selectedLut) : null;
  const detailSettingsSliders =
    detailSettings === "vignette" ? VIGNETTE_TUNE_SLIDERS : GRAIN_TUNE_SLIDERS;
  const vignetteSettingsActive = VIGNETTE_TUNE_SLIDERS.some(
    (slider) => Math.abs(grading.details[slider.key] - normalizedDefaultValue(slider)) > 0.0001,
  );
  const grainSettingsActive = GRAIN_TUNE_SLIDERS.some(
    (slider) => Math.abs(grading.details[slider.key] - normalizedDefaultValue(slider)) > 0.0001,
  );

  const applyPreset = (preset: string) => {
    const next = normalizeHfColorGrading({ preset, intensity: 1, lut: grading.lut });
    if (next) onCommitColorGrading(next);
  };
  const updateFilterIntensity = (value: number) => {
    onCommitColorGrading({
      ...grading,
      intensity: value / 100,
    });
  };
  const applyLut = (src: string | null, intensity = 1) => {
    onCommitColorGrading({
      ...grading,
      intensity: visibleIntensity(grading),
      lut: src ? { src, intensity } : null,
    });
  };
  const updateLutIntensity = (value: number) => {
    if (!grading.lut) return;
    applyLut(grading.lut.src, value / 100);
  };
  const importLuts = async (files: FileList | null) => {
    if (!files?.length || !onImportAssets) return;
    const uploaded = await onImportAssets(files, LUT_UPLOAD_DIR);
    const firstLut = uploaded.find((asset) => LUT_EXT.test(asset));
    if (firstLut) applyLut(firstLut, 1);
  };
  const commitDetailSlider = (slider: DetailSlider, next: number) => {
    onCommitColorGrading({
      ...grading,
      intensity: visibleIntensity(grading),
      details: {
        ...grading.details,
        [slider.key]: next / slider.scale,
      },
    });
  };
  const resetDetailSlider = (slider: DetailSlider) => {
    onCommitColorGrading({
      ...grading,
      intensity: visibleIntensity(grading),
      details: {
        ...grading.details,
        [slider.key]: normalizedDefaultValue(slider),
      },
    });
  };
  const renderDetailSlider = (slider: DetailSlider, settings?: SliderSettings) => {
    const value = Math.round(grading.details[slider.key] * slider.scale);
    return (
      <ColorGradingSliderControl
        key={slider.key}
        label={slider.label}
        value={value}
        min={slider.min}
        max={slider.max}
        step={slider.step}
        neutral={slider.defaultValue ?? 0}
        suffix={slider.suffix}
        displayValue={`${value}%`}
        settings={settings}
        onCommit={(next) => commitDetailSlider(slider, next)}
        onReset={() => resetDetailSlider(slider)}
      />
    );
  };

  return (
    <div className="space-y-3">
      <label className="grid min-w-0 gap-1.5">
        <span className={LABEL}>Preset</span>
        <select
          value={String(grading.preset ?? "neutral")}
          onChange={(event) => applyPreset(event.target.value)}
          className="w-full min-w-0 rounded-md bg-panel-input px-3 py-2 text-[11px] font-medium text-panel-text-1 outline-none"
        >
          {HF_COLOR_GRADING_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>
      <ColorGradingSliderControl
        label="Preset strength"
        value={Math.round(grading.intensity * 100)}
        min={0}
        max={100}
        step={1}
        neutral={0}
        suffix="%"
        displayValue={`${Math.round(grading.intensity * 100)}%`}
        onCommit={updateFilterIntensity}
        onReset={() => updateFilterIntensity(100)}
      />

      <div className="min-w-0 rounded-md border border-panel-border/70 bg-panel-input/15">
        <button
          type="button"
          className="flex h-8 w-full min-w-0 items-center gap-1.5 px-2 text-left text-[11px] font-medium text-panel-text-3 transition-colors hover:bg-panel-hover/60 hover:text-panel-text-1"
          onClick={() => setLutOpen((value) => !value)}
          aria-expanded={lutOpen}
        >
          {lutOpen ? (
            <ChevronDown size={11} className="flex-shrink-0 text-panel-text-5" />
          ) : (
            <ChevronRight size={11} className="flex-shrink-0 text-panel-text-5" />
          )}
          <span className="min-w-0 flex-1 truncate">Custom LUT</span>
          {grading.lut && (
            <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-studio-accent" />
          )}
        </button>
        {lutOpen && (
          <div className="grid gap-1.5 border-t border-panel-border/60 p-1.5">
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_28px] gap-2">
              <select
                value={selectedLut}
                onChange={(event) => {
                  const nextSrc = event.target.value;
                  applyLut(
                    nextSrc || null,
                    nextSrc && grading.lut?.src === nextSrc ? grading.lut.intensity : 1,
                  );
                }}
                className="w-full min-w-0 rounded-md bg-panel-input px-3 py-2 text-[11px] font-medium text-panel-text-1 outline-none"
                title="Uploaded .cube LUT"
              >
                <option value="">None</option>
                {lutAssets.length > 0 && (
                  <optgroup label="Uploaded LUTs">
                    {lutAssets.map((asset) => (
                      <option key={asset} value={asset}>
                        {asset.split("/").pop() ?? asset}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <button
                type="button"
                disabled={!onImportAssets}
                onClick={(event) => {
                  event.stopPropagation();
                  lutInputRef.current?.click();
                }}
                className="flex h-8 w-8 items-center justify-center rounded-md bg-panel-input text-panel-text-4 transition-colors hover:bg-panel-hover hover:text-panel-text-1 disabled:cursor-not-allowed disabled:opacity-40"
                title="Import .cube LUT"
                aria-label="Import .cube LUT"
              >
                <Plus size={13} />
              </button>
              <input
                ref={lutInputRef}
                type="file"
                accept=".cube"
                multiple
                className="hidden"
                onChange={(event) => {
                  void importLuts(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
              />
            </div>
            {grading.lut && (
              <div className="grid gap-2">
                {selectedProjectLut && (
                  <div className="flex min-w-0 items-start gap-2 text-[10px] leading-4 text-panel-text-3">
                    <span className="mt-[5px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-studio-accent" />
                    <span className="min-w-0 flex-1 truncate" title={selectedProjectLut}>
                      <span className="font-medium text-panel-text-2">Uploaded LUT</span>
                      {` · ${selectedProjectLut}`}
                    </span>
                  </div>
                )}
                <ColorGradingSliderControl
                  label="LUT Strength"
                  value={Math.round((grading.lut.intensity ?? 1) * 100)}
                  min={0}
                  max={100}
                  step={1}
                  neutral={0}
                  suffix="%"
                  displayValue={`${Math.round((grading.lut.intensity ?? 1) * 100)}%`}
                  onCommit={updateLutIntensity}
                  onReset={() => updateLutIntensity(100)}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid min-w-0 gap-1.5">
        <span className={LABEL}>Adjust</span>
        <div className="grid min-w-0 grid-cols-2 gap-1.5">
          {ADJUST_SLIDERS.map((slider) => {
            const value = grading.adjust[slider.key] * slider.scale;
            const isExposure = slider.key === "exposure";
            return (
              <ColorGradingSliderControl
                key={slider.key}
                label={slider.label}
                value={Math.round(value)}
                min={slider.min}
                max={slider.max}
                step={slider.step}
                neutral={0}
                scale={isExposure ? 100 : 1}
                suffix={isExposure ? "" : slider.suffix}
                displayValue={
                  isExposure
                    ? `${value > 0 ? "+" : ""}${(value / 100).toFixed(2)}`
                    : `${Math.round(value)}%`
                }
                onCommit={(next) => {
                  onCommitColorGrading({
                    ...grading,
                    intensity: visibleIntensity(grading),
                    adjust: {
                      ...grading.adjust,
                      [slider.key]: next / slider.scale,
                    },
                  });
                }}
                onReset={() => {
                  onCommitColorGrading({
                    ...grading,
                    intensity: visibleIntensity(grading),
                    adjust: {
                      ...grading.adjust,
                      [slider.key]: 0,
                    },
                  });
                }}
              />
            );
          })}
        </div>
      </div>

      <div className="grid min-w-0 gap-1.5">
        <span className={LABEL}>Finishing</span>
        <div className="grid min-w-0 grid-cols-2 gap-1.5">
          {AMOUNT_DETAIL_SLIDERS.map((slider) =>
            renderDetailSlider(slider, {
              active: slider.key === "vignette" ? vignetteSettingsActive : grainSettingsActive,
              label: `${slider.label} settings`,
              onClick: () =>
                setDetailSettings((current) =>
                  current === slider.key ? null : (slider.key as "vignette" | "grain"),
                ),
            }),
          )}
        </div>
        {detailSettings && (
          <div className="grid min-w-0 gap-1.5 rounded-md border border-panel-border bg-panel-input/40 p-1.5 shadow-xl shadow-black/20">
            <div className="flex min-w-0 items-center gap-2 px-0.5">
              <span className={`${LABEL} min-w-0 flex-1 truncate`}>
                {detailSettings === "vignette" ? "Vignette settings" : "Grain settings"}
              </span>
              <button
                type="button"
                aria-label="Close settings"
                title="Close settings"
                onClick={() => setDetailSettings(null)}
                className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-panel-text-5 transition-colors hover:bg-panel-hover hover:text-panel-text-1"
              >
                <X size={11} />
              </button>
            </div>
            <div className="grid min-w-0 grid-cols-2 gap-1.5">
              {detailSettingsSliders.map((slider) => renderDetailSlider(slider))}
            </div>
          </div>
        )}
      </div>

      <div className="grid min-w-0 gap-1.5">
        <span className={LABEL}>Effects</span>
        <div className="grid min-w-0 grid-cols-2 gap-1.5">
          {EFFECT_SLIDERS.map((slider) => {
            const value = grading.effects[slider.key] * slider.scale;
            return (
              <ColorGradingSliderControl
                key={slider.key}
                label={slider.label}
                value={Math.round(value)}
                min={slider.min}
                max={slider.max}
                step={slider.step}
                neutral={0}
                suffix={slider.suffix}
                displayValue={`${Math.round(value)}%`}
                onCommit={(next) => {
                  onCommitColorGrading({
                    ...grading,
                    intensity: visibleIntensity(grading),
                    effects: {
                      ...grading.effects,
                      [slider.key]: next / slider.scale,
                    },
                  });
                }}
                onReset={() => {
                  onCommitColorGrading({
                    ...grading,
                    intensity: visibleIntensity(grading),
                    effects: {
                      ...grading.effects,
                      [slider.key]: 0,
                    },
                  });
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
