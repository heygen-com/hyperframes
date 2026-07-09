import { useMemo, useRef, useState } from "react";
import {
  HF_COLOR_GRADING_PRESETS,
  isHfColorGradingActive,
  normalizeHfColorGrading,
  type HfColorGradingAdjustKey,
  type NormalizedHfColorGrading,
} from "@hyperframes/core/color-grading";
import { Compare, Plus, RotateCcw } from "../../icons/SystemIcons";
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
  const { grading, compareEnabled, runtimeStatus, commitCompare, resetGrading } = state;
  const gradingActive = isHfColorGradingActive(grading);

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
          commitCompare(true);
          const release = () => {
            commitCompare(false);
            window.removeEventListener("pointerup", release);
            window.removeEventListener("pointercancel", release);
          };
          window.addEventListener("pointerup", release);
          window.addEventListener("pointercancel", release);
        }}
        title="Hold to show original"
        className="flex-shrink-0 text-panel-text-3 hover:text-panel-text-1 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Compare size={12} />
      </button>
      <span
        data-flat-grade-status-dot="true"
        title={runtimeStatus.message}
        className={`h-[5px] w-[5px] flex-shrink-0 rounded-full ${STATUS_DOT_CLASS[runtimeStatus.state]}`}
      />
      <button
        type="button"
        data-flat-grade-reset="true"
        title="Reset color grading"
        onClick={(e) => {
          e.stopPropagation();
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

function formatAdjustValue(key: HfColorGradingAdjustKey, rawPercent: number): string {
  if (key === "exposure") {
    const stops = rawPercent / 100;
    return `${stops >= 0 ? "+" : ""}${stops.toFixed(2)}`;
  }
  return `${Math.round(rawPercent)}%`;
}

export function FlatColorGradingSection({
  grading,
  assets,
  onImportAssets,
  onCommitColorGrading,
  applyScope: _applyScope,
  applyBusy: _applyBusy,
  onSetApplyScope: _onSetApplyScope,
  onApplyToScope: _onApplyToScope,
  onApplyScopeAvailable: _onApplyScopeAvailable,
  mediaMetadata: _mediaMetadata,
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
  const lutInputRef = useRef<HTMLInputElement>(null);
  const [lutOpen, setLutOpen] = useState(false);
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
    onCommitColorGrading({ ...grading, lut: src ? { src, intensity } : null });
  };
  const importLuts = async (files: FileList | null) => {
    if (!files?.length || !onImportAssets) return;
    const uploaded = await onImportAssets(files, "assets/luts");
    const firstLut = uploaded.find((asset) => LUT_EXT.test(asset));
    if (firstLut) applyLut(firstLut, 1);
  };

  return (
    <div className="space-y-1.5">
      <div data-flat-grade-preset="true" className="flex min-h-[30px] items-center justify-between">
        <span className="text-[11px] text-panel-text-2">Preset</span>
        <FlatSelectRow
          label=""
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
                value={lut?.src ?? ""}
                onChange={(e) => {
                  const src = e.target.value;
                  applyLut(src || null, src && lut?.src === src ? lut.intensity : 1);
                }}
                className="bg-transparent font-mono text-[10px] text-panel-text-3 outline-none"
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
          const scale = slider.key === "exposure" ? 100 : 100;
          const rawPercent = grading.adjust[slider.key] * scale;
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
                    adjust: { ...grading.adjust, [slider.key]: next / scale },
                  })
                }
                onReset={() =>
                  onCommitColorGrading({
                    ...grading,
                    adjust: { ...grading.adjust, [slider.key]: 0 },
                  })
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
