import { useMemo, useRef, useState } from "react";
import { Plus, RotateCcw, X } from "../../icons/SystemIcons";
import {
  buildDefaultGradientModel,
  insertGradientStop,
  parseGradient,
  serializeGradient,
  type GradientModel,
} from "./gradientValue";
import { IMAGE_EXT } from "../../utils/mediaTypes";
import { FIELD, LABEL, RESPONSIVE_GRID } from "./propertyPanelHelpers";
import {
  DetailField,
  SelectField,
  SegmentedControl,
  SliderControl,
} from "./propertyPanelPrimitives";
import { ColorField } from "./propertyPanelColor";

/* ------------------------------------------------------------------ */
/*  Asset path helpers                                                 */
/* ------------------------------------------------------------------ */

function normalizeProjectPath(value: string): string {
  const trimmed = value.trim();
  const maybeUrl = /^[a-z]+:\/\//i.test(trimmed) ? new URL(trimmed).pathname : trimmed;
  return decodeURIComponent(maybeUrl)
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "");
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

function toProjectRootAssetPath(assetPath: string): string {
  return normalizeProjectPath(assetPath);
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

/* ------------------------------------------------------------------ */
/*  ImageFillField                                                     */
/* ------------------------------------------------------------------ */

export function ImageFillField({
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const imageAssets = useMemo(() => assets.filter((a) => IMAGE_EXT.test(a)), [assets]);
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
      const nextImage = uploaded.find((a) => IMAGE_EXT.test(a));
      if (nextImage) onCommit(`url("${toProjectRootAssetPath(nextImage)}")`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid min-w-0 gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <span className={LABEL}>Project asset</span>
          <button
            type="button"
            disabled={disabled || uploading}
            onClick={() => fileInputRef.current?.click()}
            className={`inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 text-[11px] font-medium text-neutral-300 transition-colors ${
              disabled || uploading
                ? "cursor-not-allowed text-neutral-600"
                : "cursor-pointer hover:border-neutral-600 hover:text-white"
            }`}
          >
            <Plus size={12} className="flex-shrink-0" />
            <span className="truncate">{uploading ? "Uploading…" : "Upload image"}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            aria-label="Upload image asset"
            disabled={disabled || uploading}
            className="hidden"
            onChange={async (event) => {
              await handleUpload(event.target.files);
              event.target.value = "";
            }}
          />
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
                  const next = e.target.value;
                  if (!next) {
                    onCommit("none");
                    return;
                  }
                  onCommit(`url("${toProjectRootAssetPath(next)}")`);
                }}
                className="min-w-0 w-full appearance-none bg-transparent text-[11px] font-medium text-neutral-100 outline-none disabled:cursor-not-allowed disabled:text-neutral-600"
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

/* ------------------------------------------------------------------ */
/*  GradientField                                                      */
/* ------------------------------------------------------------------ */

export function GradientField({
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
    const stops = parsed.stops.map((stop, i) => (i === index ? { ...stop, ...partial } : stop));
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
    commit({ ...parsed, stops: parsed.stops.filter((_, i) => i !== index) });
  };

  const previewStyle = { backgroundImage: serializeGradient(parsed) };

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
            addStop(((event.clientX - rect.left) / rect.width) * 100);
          }}
        >
          {parsed.stops.map((stop, index) => (
            <div
              key={`stop-preview-${index}`}
              className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
              style={{
                left: `calc(${stop.position}% - 8px)`,
                backgroundColor: stop.color,
              }}
            />
          ))}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
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
              className="h-4 w-4 rounded border-neutral-700 bg-neutral-950 text-panel-accent focus:ring-panel-accent"
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
            formatDisplayValue={(next) => `${Math.round(next)}°`}
            onCommit={(next) => patch({ angle: next })}
          />
        </div>
      )}

      {parsed.kind === "radial" && (
        <div className={RESPONSIVE_GRID}>
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
        <div className={RESPONSIVE_GRID}>
          <div className="grid min-w-0 gap-1.5">
            <span className={LABEL}>Center X</span>
            <SliderControl
              value={parsed.centerX}
              min={0}
              max={100}
              step={1}
              disabled={disabled}
              displayValue={`${Math.round(parsed.centerX)}%`}
              formatDisplayValue={(next) => `${Math.round(next)}%`}
              onCommit={(next) => patch({ centerX: next })}
            />
          </div>
          <div className="grid min-w-0 gap-1.5">
            <span className={LABEL}>Center Y</span>
            <SliderControl
              value={parsed.centerY}
              min={0}
              max={100}
              step={1}
              disabled={disabled}
              displayValue={`${Math.round(parsed.centerY)}%`}
              formatDisplayValue={(next) => `${Math.round(next)}%`}
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
              key={`stop-editor-${index}`}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_68px_28px] gap-2"
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
