import type { DomEditLayerItem } from "./domEditing";

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
