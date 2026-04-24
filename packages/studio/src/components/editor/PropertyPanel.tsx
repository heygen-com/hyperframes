import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ClipboardList,
  Eye,
  Layers,
  Move,
  Palette,
  Plus,
  RotateCcw,
  Settings,
  Type,
  X,
} from "../../icons/SystemIcons";
import { mergeColorWithExistingAlpha, parseCssColor, toColorPickerValue } from "./colorValue";
import {
  buildDefaultGradientModel,
  insertGradientStop,
  parseGradient,
  serializeGradient,
  type GradientModel,
} from "./gradientValue";
import { isTextEditableSelection, type DomEditSelection } from "./domEditing";
import { IMAGE_EXT } from "../../utils/mediaTypes";

type FocusedSection = "position" | "styles" | null;

interface PropertyPanelProps {
  projectId: string;
  assets: string[];
  element: DomEditSelection | null;
  copiedAgentPrompt: boolean;
  focusedSection?: FocusedSection;
  onFocusSectionHandled?: () => void;
  onClearSelection: () => void;
  onSetStyle: (prop: string, value: string) => void;
  onSetText: (value: string) => void;
  onAskAgent: () => void;
  onImportAssets?: (files: FileList) => Promise<string[]>;
}

const FIELD =
  "rounded-xl border border-neutral-800 bg-neutral-900/95 px-3 py-2 text-neutral-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors focus-within:border-neutral-600";
const LABEL = "text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-500";
const EMPTY_STYLES: Record<string, string> = {};

function parseNumericValue(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumericValue(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded)
    ? `${rounded}`
    : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

interface ParsedNumericToken {
  value: number;
  unit: string;
}

function parseNumericToken(value: string | undefined): ParsedNumericToken | null {
  if (!value) return null;
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)([a-z%]*)$/i);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1]);
  if (!Number.isFinite(parsed)) return null;
  return {
    value: parsed,
    unit: match[2] ?? "",
  };
}

function adjustNumericToken(
  value: string,
  direction: 1 | -1,
  modifiers?: { shiftKey?: boolean; altKey?: boolean },
): string | null {
  const token = parseNumericToken(value);
  if (!token) return null;

  const baseStep = modifiers?.altKey ? 0.1 : modifiers?.shiftKey ? 10 : 1;
  const nextValue = token.value + baseStep * direction;
  return `${formatNumericValue(nextValue)}${token.unit}`;
}

function formatColorToken(value: string): string {
  const parsed = parseCssColor(value);
  if (!parsed) return value;
  const hex = toColorPickerValue(value).replace(/^#/, "").toUpperCase();
  return `${hex} / ${Math.round(parsed.alpha * 100)}%`;
}

function extractBackgroundImageUrl(value: string | undefined): string {
  if (!value) return "";
  const match = value.match(/url\((['"]?)(.*?)\1\)/i);
  return match?.[2] ?? "";
}

function normalizeProjectPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.?\//, "");
}

function toRelativeProjectAssetPath(sourceFile: string, assetPath: string): string {
  const fromParts = normalizeProjectPath(sourceFile).split("/").filter(Boolean);
  const targetParts = normalizeProjectPath(assetPath).split("/").filter(Boolean);

  fromParts.pop();

  while (fromParts.length > 0 && targetParts.length > 0 && fromParts[0] === targetParts[0]) {
    fromParts.shift();
    targetParts.shift();
  }

  return [...fromParts.map(() => ".."), ...targetParts].join("/") || assetPath;
}

function resolveSelectedAsset(
  imageUrl: string,
  sourceFile: string,
  assets: string[],
): string | null {
  const normalizedUrl = normalizeProjectPath(imageUrl);
  if (!normalizedUrl) return null;

  for (const asset of assets) {
    const normalizedAsset = normalizeProjectPath(asset);
    const relativeAsset = toRelativeProjectAssetPath(sourceFile, asset);
    if (
      normalizedUrl === normalizedAsset ||
      normalizedUrl === relativeAsset ||
      normalizedUrl.endsWith(`/${normalizedAsset}`) ||
      normalizedUrl.endsWith(`/${relativeAsset}`)
    ) {
      return asset;
    }
  }

  return null;
}

function collectSelectionColors(styles: Record<string, string>) {
  const candidates = [
    { source: "Fill", value: styles["background-color"] },
    { source: "Text", value: styles.color },
  ];

  const deduped = new Map<string, { swatch: string; token: string; sources: string[] }>();

  for (const candidate of candidates) {
    if (!candidate.value) continue;
    const parsed = parseCssColor(candidate.value);
    if (!parsed || parsed.alpha <= 0) continue;

    const key = `${toColorPickerValue(candidate.value)}-${Math.round(parsed.alpha * 100)}`;
    const existing = deduped.get(key);
    if (existing) {
      existing.sources.push(candidate.source);
      continue;
    }

    deduped.set(key, {
      swatch: toColorPickerValue(candidate.value),
      token: formatColorToken(candidate.value),
      sources: [candidate.source],
    });
  }

  return Array.from(deduped.values());
}

function CommitField({
  value,
  disabled,
  onCommit,
}: {
  value: string;
  disabled?: boolean;
  onCommit: (nextValue: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);

  valueRef.current = value;

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(
    () => () => {
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    },
    [],
  );

  const commitDraft = (nextDraft: string) => {
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    if (nextDraft !== valueRef.current) {
      onCommit(nextDraft);
    }
  };

  const scheduleCommit = (nextDraft: string) => {
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    commitTimerRef.current = setTimeout(() => {
      if (nextDraft !== valueRef.current) {
        onCommit(nextDraft);
      }
    }, 120);
  };

  return (
    <input
      type="text"
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commitDraft(draft)}
      onWheel={(e) => {
        if (disabled) return;
        const delta = e.deltaY === 0 ? e.deltaX : e.deltaY;
        if (delta === 0) return;
        const nextDraft = adjustNumericToken(draft, delta < 0 ? 1 : -1, e);
        if (!nextDraft) return;
        e.preventDefault();
        setDraft(nextDraft);
        scheduleCommit(nextDraft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
          return;
        }
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        const nextDraft = adjustNumericToken(draft, e.key === "ArrowUp" ? 1 : -1, e);
        if (!nextDraft) return;
        e.preventDefault();
        setDraft(nextDraft);
        scheduleCommit(nextDraft);
      }}
      title={parseNumericToken(value) ? "Scroll or use Arrow keys to adjust" : undefined}
      className="w-full bg-transparent text-[11px] font-medium text-neutral-100 outline-none disabled:cursor-not-allowed disabled:text-neutral-600"
    />
  );
}

function MetricField({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onCommit: (nextValue: string) => void;
}) {
  return (
    <div className={FIELD}>
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-medium text-neutral-500">{label}</span>
        <CommitField value={value} disabled={disabled} onCommit={onCommit} />
      </div>
    </div>
  );
}

function DetailField({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onCommit: (nextValue: string) => void;
}) {
  return (
    <label className="grid gap-1.5">
      <span className={LABEL}>{label}</span>
      <div className={FIELD}>
        <CommitField value={value} disabled={disabled} onCommit={onCommit} />
      </div>
    </label>
  );
}

function TextAreaField({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onCommit: (nextValue: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <label className="grid gap-1.5">
      <span className={LABEL}>{label}</span>
      <div className={FIELD}>
        <textarea
          value={draft}
          disabled={disabled}
          rows={4}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft !== value && onCommit(draft)}
          className="w-full resize-none bg-transparent text-[11px] font-medium text-neutral-100 outline-none disabled:cursor-not-allowed disabled:text-neutral-600"
        />
      </div>
    </label>
  );
}

function ColorField({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onCommit: (nextValue: string) => void;
}) {
  const pickerRef = useRef<HTMLInputElement | null>(null);
  const [pickerValue, setPickerValue] = useState(toColorPickerValue(value));

  useEffect(() => {
    setPickerValue(toColorPickerValue(value));
  }, [value]);

  const openPicker = () => {
    const picker = pickerRef.current;
    if (!picker || disabled) return;
    if (typeof picker.showPicker === "function") {
      picker.showPicker();
      return;
    }
    picker.click();
  };

  return (
    <div className="grid gap-1.5">
      <span className={LABEL}>{label}</span>
      <button
        type="button"
        disabled={disabled}
        aria-label={`Pick ${label.toLowerCase()} color`}
        onClick={openPicker}
        className={`${FIELD} flex items-center gap-3 text-left hover:border-neutral-700 disabled:cursor-not-allowed`}
      >
        <div
          className="relative h-7 w-7 flex-shrink-0 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
          style={{ backgroundColor: value || "transparent" }}
        />
        <span className="truncate text-[11px] font-medium text-neutral-100">{value}</span>
      </button>
      <input
        ref={pickerRef}
        type="color"
        tabIndex={-1}
        disabled={disabled}
        value={pickerValue}
        onChange={(e) => {
          const nextValue = e.target.value;
          setPickerValue(nextValue);
          onCommit(mergeColorWithExistingAlpha(nextValue, value));
        }}
        className="pointer-events-none absolute opacity-0"
        aria-hidden="true"
      />
    </div>
  );
}

function ImageFillField({
  projectId,
  sourceFile,
  value,
  assets,
  disabled,
  onCommit,
  onImportAssets,
}: {
  projectId: string;
  sourceFile: string;
  value: string;
  assets: string[];
  disabled?: boolean;
  onCommit: (nextValue: string) => void;
  onImportAssets?: (files: FileList) => Promise<string[]>;
}) {
  const [uploading, setUploading] = useState(false);
  const imageAssets = useMemo(() => assets.filter((asset) => IMAGE_EXT.test(asset)), [assets]);
  const selectedAsset = useMemo(
    () => resolveSelectedAsset(value, sourceFile, imageAssets),
    [imageAssets, sourceFile, value],
  );
  const externalUrlValue = selectedAsset ? "" : value;

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length || !onImportAssets) return;
    setUploading(true);
    try {
      const uploaded = await onImportAssets(files);
      const nextImage = uploaded.find((asset) => IMAGE_EXT.test(asset));
      if (nextImage) {
        onCommit(`url("${toRelativeProjectAssetPath(sourceFile, nextImage)}")`);
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <span className={LABEL}>Project asset</span>
          <label
            className={`relative inline-flex h-7 items-center gap-1.5 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 text-[11px] font-medium text-neutral-300 transition-colors ${
              disabled || uploading
                ? "cursor-not-allowed text-neutral-600"
                : "cursor-pointer hover:border-neutral-600 hover:text-white"
            }`}
          >
            <Plus size={12} />
            <span>{uploading ? "Uploading…" : "Upload image"}</span>
            <input
              type="file"
              accept="image/*"
              aria-label="Upload image asset"
              disabled={disabled || uploading}
              className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
              onChange={async (event) => {
                await handleUpload(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
        </div>
        {imageAssets.length > 0 ? (
          <div className="space-y-3">
            {selectedAsset && (
              <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/80">
                <img
                  src={`/api/projects/${projectId}/preview/${selectedAsset}`}
                  alt={selectedAsset.split("/").pop() ?? selectedAsset}
                  className="h-28 w-full object-contain bg-neutral-950/80"
                />
              </div>
            )}
            <div className={FIELD}>
              <select
                value={selectedAsset ?? ""}
                disabled={disabled}
                onChange={(e) => {
                  const nextAsset = e.target.value;
                  if (!nextAsset) {
                    onCommit("none");
                    return;
                  }
                  onCommit(`url("${toRelativeProjectAssetPath(sourceFile, nextAsset)}")`);
                }}
                className="w-full appearance-none bg-transparent text-[11px] font-medium text-neutral-100 outline-none disabled:cursor-not-allowed disabled:text-neutral-600"
              >
                <option value="">None</option>
                {imageAssets.map((asset) => (
                  <option key={asset} value={asset}>
                    {asset}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/50 px-3 py-3 text-[11px] leading-5 text-neutral-500">
            No image assets yet. Upload one here and Studio will also add it to the Assets tab.
          </div>
        )}
      </div>

      <DetailField
        label="External URL"
        value={externalUrlValue}
        disabled={disabled}
        onCommit={(next) => onCommit(next.trim() ? `url("${next.trim()}")` : "none")}
      />
    </div>
  );
}

function GradientField({
  value,
  fallbackColor,
  disabled,
  onCommit,
}: {
  value: string;
  fallbackColor: string | undefined;
  disabled?: boolean;
  onCommit: (nextValue: string) => void;
}) {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const parsed = parseGradient(value) ?? buildDefaultGradientModel(fallbackColor);

  const commit = (next: GradientModel) => onCommit(serializeGradient(next));

  const patch = (partial: Partial<GradientModel>) => commit({ ...parsed, ...partial });

  const updateStop = (index: number, partial: Partial<GradientModel["stops"][number]>) => {
    const stops = parsed.stops.map((stop, stopIndex) =>
      stopIndex === index ? { ...stop, ...partial } : stop,
    );
    commit({ ...parsed, stops });
  };

  const addStop = (position?: number) => {
    const nextGradient =
      position != null
        ? insertGradientStop(parsed, position)
        : insertGradientStop(
            parsed,
            parsed.stops.at(-1)?.position != null
              ? Math.min(100, (parsed.stops.at(-1)?.position ?? 90) + 10)
              : 100,
          );
    commit(nextGradient);
  };

  const removeStop = (index: number) => {
    if (parsed.stops.length <= 2) return;
    commit({ ...parsed, stops: parsed.stops.filter((_, stopIndex) => stopIndex !== index) });
  };

  const previewStyle = {
    backgroundImage: serializeGradient(parsed),
  };

  return (
    <div className="space-y-4">
      <div className={`${FIELD} space-y-3 p-3`}>
        <div
          ref={previewRef}
          className="relative h-11 overflow-hidden rounded-lg border border-neutral-700"
          style={previewStyle}
          onClick={(event) => {
            if (disabled) return;
            const rect = previewRef.current?.getBoundingClientRect();
            if (!rect || rect.width <= 0) return;
            const position = ((event.clientX - rect.left) / rect.width) * 100;
            addStop(position);
          }}
        >
          {parsed.stops.map((stop, index) => (
            <div
              key={`${stop.color}-${stop.position}-${index}`}
              className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
              style={{
                left: `calc(${stop.position}% - 8px)`,
                backgroundColor: stop.color,
              }}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            disabled={disabled}
            value={parsed.kind}
            onChange={(next) => patch({ kind: next as GradientModel["kind"] })}
            options={[
              { label: "Linear", value: "linear" },
              { label: "Radial", value: "radial" },
              { label: "Conic", value: "conic" },
            ]}
          />
          <label className="flex items-center gap-2 text-[11px] font-medium text-neutral-400">
            <input
              type="checkbox"
              checked={parsed.repeating}
              disabled={disabled}
              onChange={(e) => patch({ repeating: e.target.checked })}
              className="h-4 w-4 rounded border-neutral-700 bg-neutral-950 text-[#3ce6ac] focus:ring-[#3ce6ac]"
            />
            Repeat
          </label>
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              commit({
                ...parsed,
                stops: [...parsed.stops].reverse().map((stop) => ({
                  ...stop,
                  position: 100 - stop.position,
                })),
              })
            }
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 text-[11px] font-medium text-neutral-300 transition-colors hover:border-neutral-600 hover:text-white disabled:cursor-not-allowed disabled:text-neutral-600"
          >
            <RotateCcw size={12} />
            Reverse
          </button>
        </div>
      </div>

      {(parsed.kind === "linear" || parsed.kind === "conic") && (
        <div className="grid gap-1.5">
          <span className={LABEL}>{parsed.kind === "linear" ? "Angle" : "Start angle"}</span>
          <SliderControl
            value={parsed.angle}
            min={0}
            max={360}
            step={1}
            disabled={disabled}
            displayValue={`${Math.round(parsed.angle)}°`}
            onCommit={(next) => patch({ angle: next })}
          />
        </div>
      )}

      {parsed.kind === "radial" && (
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label="Shape"
            value={parsed.shape}
            disabled={disabled}
            onChange={(next) => patch({ shape: next as GradientModel["shape"] })}
            options={["ellipse", "circle"]}
          />
          <SelectField
            label="Size"
            value={parsed.radialSize}
            disabled={disabled}
            onChange={(next) => patch({ radialSize: next as GradientModel["radialSize"] })}
            options={["closest-side", "closest-corner", "farthest-side", "farthest-corner"]}
          />
        </div>
      )}

      {(parsed.kind === "radial" || parsed.kind === "conic") && (
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <span className={LABEL}>Center X</span>
            <SliderControl
              value={parsed.centerX}
              min={0}
              max={100}
              step={1}
              disabled={disabled}
              displayValue={`${Math.round(parsed.centerX)}%`}
              onCommit={(next) => patch({ centerX: next })}
            />
          </div>
          <div className="grid gap-1.5">
            <span className={LABEL}>Center Y</span>
            <SliderControl
              value={parsed.centerY}
              min={0}
              max={100}
              step={1}
              disabled={disabled}
              displayValue={`${Math.round(parsed.centerY)}%`}
              onCommit={(next) => patch({ centerY: next })}
            />
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className={LABEL}>Stops</span>
          <button
            type="button"
            disabled={disabled || parsed.stops.length >= 6}
            onClick={() => addStop()}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 text-[11px] font-medium text-neutral-300 transition-colors hover:border-neutral-600 hover:text-white disabled:cursor-not-allowed disabled:text-neutral-600"
          >
            <Plus size={12} />
            Add stop
          </button>
        </div>
        <div className="space-y-3">
          {parsed.stops.map((stop, index) => (
            <div
              key={`${stop.color}-${stop.position}-${index}`}
              className="grid grid-cols-[1fr_84px_30px] gap-3"
            >
              <ColorField
                label={`Stop ${index + 1}`}
                value={stop.color}
                disabled={disabled}
                onCommit={(next) => updateStop(index, { color: next })}
              />
              <DetailField
                label="Pos"
                value={`${Math.round(stop.position)}%`}
                disabled={disabled}
                onCommit={(next) =>
                  updateStop(index, {
                    position: Number.parseFloat(next.replace("%", "")) || 0,
                  })
                }
              />
              <button
                type="button"
                disabled={disabled || parsed.stops.length <= 2}
                onClick={() => removeStop(index)}
                className="mt-[22px] flex h-10 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-950 text-neutral-400 transition-colors hover:border-neutral-600 hover:text-white disabled:cursor-not-allowed disabled:text-neutral-700"
                aria-label={`Remove stop ${index + 1}`}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SliderControl({
  value,
  min,
  max,
  step,
  displayValue,
  disabled,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  disabled?: boolean;
  onCommit: (nextValue: number) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(Number(e.target.value))}
        onMouseUp={() => draft !== value && onCommit(draft)}
        onTouchEnd={() => draft !== value && onCommit(draft)}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-neutral-800 accent-[#3ce6ac] disabled:cursor-not-allowed"
      />
      <div className="min-w-[64px] rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-right text-[11px] font-medium text-neutral-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        {displayValue}
      </div>
    </div>
  );
}

function SegmentedControl({
  options,
  value,
  disabled,
  onChange,
}: {
  options: Array<{ label: string; value: string }>;
  value: string;
  disabled?: boolean;
  onChange: (nextValue: string) => void;
}) {
  return (
    <div
      className="grid gap-1 rounded-xl bg-neutral-900 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed ${
              selected
                ? "bg-neutral-800 text-white shadow-[0_1px_3px_rgba(0,0,0,0.28)]"
                : "text-neutral-500 hover:text-neutral-200"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function SelectField({
  label,
  value,
  disabled,
  options,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  options: string[];
  onChange: (nextValue: string) => void;
}) {
  return (
    <label className="grid gap-1.5">
      <span className={LABEL}>{label}</span>
      <div className={FIELD}>
        <select
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none bg-transparent text-[11px] font-medium text-neutral-100 outline-none disabled:cursor-not-allowed disabled:text-neutral-600"
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}

function Section({
  title,
  icon,
  children,
  sectionRef,
  accessory,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  sectionRef?: React.RefObject<HTMLDivElement | null>;
  accessory?: ReactNode;
}) {
  return (
    <section ref={sectionRef} className="border-t border-neutral-800/80 px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-neutral-500">{icon}</span>
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-300">
            {title}
          </h3>
        </div>
        {accessory}
      </div>
      {children}
    </section>
  );
}

function SelectionColorRow({
  swatch,
  token,
  sources,
}: {
  swatch: string;
  token: string;
  sources: string[];
}) {
  return (
    <div className={`${FIELD} flex items-center gap-3`}>
      <div
        className="h-7 w-7 flex-shrink-0 rounded-lg border border-neutral-700"
        style={{ backgroundColor: swatch }}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium text-neutral-100">{token}</div>
        <div className="truncate text-[11px] uppercase tracking-[0.18em] text-neutral-500">
          {sources.join(" · ")}
        </div>
      </div>
    </div>
  );
}

export const PropertyPanel = memo(function PropertyPanel({
  projectId,
  assets,
  element,
  copiedAgentPrompt,
  focusedSection = null,
  onFocusSectionHandled,
  onClearSelection,
  onSetStyle,
  onSetText,
  onAskAgent,
}: PropertyPanelProps) {
  const positionRef = useRef<HTMLDivElement | null>(null);
  const stylesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!focusedSection) return;
    const target = focusedSection === "position" ? positionRef.current : stylesRef.current;
    target?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    onFocusSectionHandled?.();
  }, [focusedSection, onFocusSectionHandled]);

  const styles = element?.computedStyles ?? EMPTY_STYLES;
  const selectionColors = useMemo(() => collectSelectionColors(styles), [styles]);
  const backgroundImage = styles["background-image"] ?? "none";
  const fillMode =
    backgroundImage && backgroundImage !== "none"
      ? backgroundImage.includes("gradient")
        ? "Gradient"
        : "Image"
      : "Solid";
  const [preferredFillMode, setPreferredFillMode] = useState(fillMode);
  const imageUrl = extractBackgroundImageUrl(backgroundImage);

  useEffect(() => {
    setPreferredFillMode(fillMode);
  }, [fillMode, element?.id, element?.selector, backgroundImage]);

  if (!element) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-neutral-900 px-6 text-center">
        <Eye size={18} className="mb-3 text-neutral-600" />
        <p className="text-sm font-medium text-neutral-200">Select an element in the preview.</p>
        <p className="mt-2 max-w-[260px] text-xs leading-5 text-neutral-500">
          The inspector is tuned for direct DOM edits with safer geometry controls, color picking,
          and cleaner Paper-style grouping.
        </p>
      </div>
    );
  }

  const styleEditingDisabled = !element.capabilities.canEditStyles;
  const moveEditingDisabled = styleEditingDisabled || !element.capabilities.canMove;
  const resizeEditingDisabled = styleEditingDisabled || !element.capabilities.canResize;
  const isFlex = styles.display === "flex" || styles.display === "inline-flex";
  const radiusValue = parseNumericValue(styles["border-radius"]) ?? 0;
  const opacityValue = Math.round((parseNumericValue(styles.opacity) ?? 1) * 100);
  const clipContent = ["hidden", "clip"].includes((styles.overflow ?? "").trim());
  const sourceLabel = element.id ? `#${element.id}` : element.selector;
  const showEditableSections = element.capabilities.canEditStyles;

  const handleFillModeChange = (nextMode: string) => {
    setPreferredFillMode(nextMode);
    if (nextMode === "Solid") {
      onSetStyle("background-image", "none");
      return;
    }
    if (nextMode === "Gradient" && !backgroundImage.includes("gradient")) {
      onSetStyle(
        "background-image",
        serializeGradient(buildDefaultGradientModel(styles["background-color"])),
      );
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-neutral-900 text-neutral-100">
      <div className="border-b border-neutral-800 px-5 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className={LABEL}>Document</div>
            <div className="mt-3 truncate text-[12px] font-semibold text-neutral-100">
              {element.label}
            </div>
            <div className="mt-1 truncate text-[11px] text-neutral-500">{sourceLabel}</div>
          </div>
          <button
            type="button"
            aria-label="Clear selection"
            onClick={onClearSelection}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-700 bg-neutral-950 text-neutral-500 shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-colors hover:border-neutral-600 hover:text-neutral-200"
          >
            <X size={13} />
          </button>
        </div>
        <button
          type="button"
          onClick={onAskAgent}
          className="mt-4 inline-flex h-8 items-center justify-center gap-2 rounded-xl border border-neutral-700 bg-neutral-950 px-3.5 text-[11px] font-medium text-neutral-100 transition-colors hover:border-studio-accent/40 hover:text-studio-accent"
        >
          <ClipboardList size={15} />
          <span>{copiedAgentPrompt ? "Prompt copied" : "Ask agent"}</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <Section title="Layout" icon={<Move size={15} />} sectionRef={positionRef}>
          <div className="grid grid-cols-2 gap-3">
            <MetricField
              label="X"
              value={styles.left ?? "auto"}
              disabled={moveEditingDisabled}
              onCommit={(next) => onSetStyle("left", next)}
            />
            <MetricField
              label="Y"
              value={styles.top ?? "auto"}
              disabled={moveEditingDisabled}
              onCommit={(next) => onSetStyle("top", next)}
            />
            <MetricField
              label="W"
              value={styles.width ?? "auto"}
              disabled={resizeEditingDisabled}
              onCommit={(next) => onSetStyle("width", next)}
            />
            <MetricField
              label="H"
              value={styles.height ?? "auto"}
              disabled={resizeEditingDisabled}
              onCommit={(next) => onSetStyle("height", next)}
            />
          </div>
          {element.capabilities.reasonIfDisabled && (
            <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-[12px] leading-6 text-amber-200">
              {element.capabilities.reasonIfDisabled}
            </div>
          )}
        </Section>

        {showEditableSections && isFlex && (
          <Section title="Flex" icon={<Layers size={15} />}>
            <div className="space-y-4">
              <SegmentedControl
                disabled={styleEditingDisabled}
                value={styles["flex-direction"] || "row"}
                onChange={(next) => onSetStyle("flex-direction", next)}
                options={[
                  { label: "→ Row", value: "row" },
                  { label: "↓ Column", value: "column" },
                ]}
              />
              <div className="grid grid-cols-2 gap-3">
                <SelectField
                  label="Justify"
                  value={styles["justify-content"] || "flex-start"}
                  disabled={styleEditingDisabled}
                  onChange={(next) => onSetStyle("justify-content", next)}
                  options={[
                    "flex-start",
                    "center",
                    "space-between",
                    "space-around",
                    "space-evenly",
                    "flex-end",
                  ]}
                />
                <SelectField
                  label="Align"
                  value={styles["align-items"] || "stretch"}
                  disabled={styleEditingDisabled}
                  onChange={(next) => onSetStyle("align-items", next)}
                  options={["stretch", "flex-start", "center", "flex-end", "baseline"]}
                />
              </div>
              <DetailField
                label="Gap"
                value={styles.gap ?? "0px"}
                disabled={styleEditingDisabled}
                onCommit={(next) => onSetStyle("gap", next.endsWith("px") ? next : `${next}px`)}
              />
              <label className="flex items-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-900 px-3 py-3 text-[12px] text-neutral-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <input
                  type="checkbox"
                  checked={clipContent}
                  disabled={styleEditingDisabled}
                  onChange={(e) => onSetStyle("overflow", e.target.checked ? "hidden" : "visible")}
                  className="h-4 w-4 rounded border-neutral-700 bg-neutral-950 text-[#3ce6ac] focus:ring-[#3ce6ac]"
                />
                <span>Clip content</span>
              </label>
            </div>
          </Section>
        )}

        {showEditableSections && (
          <>
            <Section title="Radius" icon={<Settings size={15} />} sectionRef={stylesRef}>
              <SliderControl
                value={radiusValue}
                min={0}
                max={Math.max(240, Math.ceil(radiusValue))}
                step={1}
                disabled={styleEditingDisabled}
                displayValue={`${formatNumericValue(radiusValue)}px`}
                onCommit={(next) => onSetStyle("border-radius", formatNumericValue(next))}
              />
            </Section>

            <Section title="Blending" icon={<Eye size={15} />}>
              <div className="space-y-4">
                <SliderControl
                  value={opacityValue}
                  min={0}
                  max={100}
                  step={1}
                  disabled={styleEditingDisabled}
                  displayValue={`${opacityValue}%`}
                  onCommit={(next) => onSetStyle("opacity", formatNumericValue(next / 100))}
                />
                <SelectField
                  label="Mode"
                  value={styles["mix-blend-mode"] || "normal"}
                  disabled={styleEditingDisabled}
                  onChange={(next) => onSetStyle("mix-blend-mode", next)}
                  options={["normal", "multiply", "screen", "overlay", "darken", "lighten"]}
                />
              </div>
            </Section>

            <Section
              title="Fill"
              icon={<Palette size={15} />}
              accessory={
                <div className="rounded-full border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-neutral-400">
                  {preferredFillMode}
                </div>
              }
            >
              <div className="space-y-4">
                <SegmentedControl
                  disabled={styleEditingDisabled}
                  value={preferredFillMode}
                  onChange={handleFillModeChange}
                  options={[
                    { label: "Solid", value: "Solid" },
                    { label: "Gradient", value: "Gradient" },
                    { label: "Image", value: "Image" },
                  ]}
                />
                {preferredFillMode === "Solid" ? (
                  <ColorField
                    label="Fill color"
                    value={styles["background-color"] ?? "transparent"}
                    disabled={styleEditingDisabled}
                    onCommit={(next) => onSetStyle("background-color", next)}
                  />
                ) : preferredFillMode === "Gradient" ? (
                  <GradientField
                    value={
                      backgroundImage !== "none"
                        ? backgroundImage
                        : serializeGradient(buildDefaultGradientModel(styles["background-color"]))
                    }
                    fallbackColor={styles["background-color"]}
                    disabled={styleEditingDisabled}
                    onCommit={(next) => onSetStyle("background-image", next)}
                  />
                ) : (
                  <ImageFillField
                    projectId={projectId}
                    sourceFile={element.sourceFile}
                    value={imageUrl}
                    assets={assets}
                    disabled={styleEditingDisabled}
                    onCommit={(next) => onSetStyle("background-image", next)}
                  />
                )}
                <ColorField
                  label="Text color"
                  value={styles.color ?? "rgb(0, 0, 0)"}
                  disabled={styleEditingDisabled}
                  onCommit={(next) => onSetStyle("color", next)}
                />
              </div>
            </Section>

            {isTextEditableSelection(element) && (
              <Section title="Text" icon={<Type size={15} />}>
                <div className="space-y-4">
                  <TextAreaField
                    label="Content"
                    value={element.textContent ?? ""}
                    disabled={false}
                    onCommit={onSetText}
                  />
                </div>
              </Section>
            )}

            {selectionColors.length > 0 && (
              <Section title="Selection colors" icon={<Palette size={15} />}>
                <div className="space-y-3">
                  {selectionColors.map((entry) => (
                    <SelectionColorRow
                      key={`${entry.swatch}-${entry.token}`}
                      swatch={entry.swatch}
                      token={entry.token}
                      sources={entry.sources}
                    />
                  ))}
                </div>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
});
