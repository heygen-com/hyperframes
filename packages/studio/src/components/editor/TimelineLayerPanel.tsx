import { memo } from "react";
import type { DomEditLayerItem } from "./domEditing";

interface TimelineLayerPanelProps {
  clipLabel: string;
  layers: DomEditLayerItem[];
  selectedLayerKey: string | null;
  onSelectLayer: (layer: DomEditLayerItem) => void;
  onClose: () => void;
}

const MEDIA_LAYER_TAGS = new Set(["audio", "canvas", "img", "picture", "svg", "video"]);

export function getTimelineLayerPanelSummary(layers: readonly DomEditLayerItem[]): string {
  const childCount = Math.max(0, layers.length - 1);
  if (childCount > 0) {
    return `${childCount} nested selectable layer${childCount === 1 ? "" : "s"}`;
  }
  const layer = layers[0];
  if (!layer) return "No selectable layers";
  return MEDIA_LAYER_TAGS.has(layer.tagName.trim().toLowerCase())
    ? "Single selectable media layer"
    : "Single selectable layer";
}

export const TimelineLayerPanel = memo(function TimelineLayerPanel({
  clipLabel,
  layers,
  selectedLayerKey,
  onSelectLayer,
  onClose,
}: TimelineLayerPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-neutral-950">
      <div className="flex items-start justify-between gap-3 border-b border-white/10 px-3 py-3">
        <div className="min-w-0">
          <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
            Clip layers
          </div>
          <div className="mt-1 truncate text-sm font-semibold text-neutral-100">{clipLabel}</div>
        </div>
        <button
          type="button"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={onClose}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-white/10 bg-black/20 text-neutral-500 transition-colors hover:border-white/20 hover:text-neutral-200"
          aria-label="Close clip layers"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
      <div className="border-b border-white/10 px-3 py-2 text-[11px] text-neutral-500">
        {getTimelineLayerPanelSummary(layers)}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {layers.map((layer) => {
          const selected = layer.key === selectedLayerKey;
          return (
            <button
              key={layer.key}
              type="button"
              data-timeline-layer-row={layer.key}
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelectLayer(layer);
              }}
              onClick={(event) => {
                event.stopPropagation();
                onSelectLayer(layer);
              }}
              className={`group flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${
                selected
                  ? "bg-studio-accent/14 text-studio-accent"
                  : "text-neutral-300 hover:bg-white/[0.04] hover:text-neutral-100"
              }`}
              style={{ paddingLeft: 10 + layer.depth * 14 }}
            >
              <span
                className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border text-[9px] font-bold uppercase ${
                  selected
                    ? "border-studio-accent/50 bg-studio-accent/18"
                    : "border-white/10 bg-black/20 text-neutral-500 group-hover:text-neutral-300"
                }`}
              >
                {layer.tagName.slice(0, 2)}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{layer.label}</span>
              {layer.childCount > 0 && (
                <span className="rounded-full border border-white/10 bg-black/25 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-neutral-500">
                  {layer.childCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
});
