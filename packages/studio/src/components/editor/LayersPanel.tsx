import { memo, useState, useCallback, useEffect, useRef } from "react";
import {
  collectDomEditLayerItems,
  getDomEditLayerKey,
  resolveDomEditSelection,
  type DomEditLayerItem,
} from "./domEditing";
import { useStudioContext } from "../../contexts/StudioContext";
import { useDomEditContext } from "../../contexts/DomEditContext";
import { usePlayerStore } from "../../player";
import { findMatchingTimelineElementId } from "../../utils/studioHelpers";
import { Layers } from "../../icons/SystemIcons";

const TAG_ICONS: Record<string, string> = {
  video: "Vi",
  audio: "Au",
  img: "Im",
  svg: "Sv",
  canvas: "Cn",
  div: "Di",
  section: "Se",
  span: "Sp",
  p: "P",
  h1: "H1",
  h2: "H2",
  h3: "H3",
  h4: "H4",
  h5: "H5",
  h6: "H6",
  a: "A",
  button: "Bt",
  ul: "Ul",
  ol: "Ol",
  li: "Li",
  style: "St",
  template: "Te",
};

function getTagBadge(tagName: string): string {
  return TAG_ICONS[tagName] ?? tagName.slice(0, 2).toUpperCase();
}

function isCompositionHost(el: HTMLElement): boolean {
  return el.hasAttribute("data-composition-src") || el.hasAttribute("data-composition-file");
}

interface CollapsedState {
  [key: string]: boolean;
}

export const LayersPanel = memo(function LayersPanel() {
  const { previewIframeRef, activeCompPath, refreshKey, compositionLoading, timelineElements } =
    useStudioContext();
  const { domEditSelection, applyDomSelection, updateDomEditHoverSelection } = useDomEditContext();

  const [layers, setLayers] = useState<DomEditLayerItem[]>([]);
  const [collapsed, setCollapsed] = useState<CollapsedState>({});
  const prevDocVersionRef = useRef(0);

  const isMasterView = !activeCompPath || activeCompPath === "index.html";

  const collectLayers = useCallback(() => {
    const iframe = previewIframeRef.current;
    if (!iframe) return;
    let doc: Document | null = null;
    try {
      doc = iframe.contentDocument;
    } catch {
      return;
    }
    if (!doc) return;

    const root =
      doc.querySelector<HTMLElement>("[data-composition-id]") ?? doc.documentElement ?? null;
    if (!root) return;

    const items = collectDomEditLayerItems(root, {
      activeCompositionPath: activeCompPath,
      isMasterView,
    });
    setLayers(items);
  }, [previewIframeRef, activeCompPath, isMasterView]);

  useEffect(() => {
    collectLayers();
  }, [collectLayers, refreshKey]);

  useEffect(() => {
    const iframe = previewIframeRef.current;
    if (!iframe) return;
    const handleLoad = () => {
      prevDocVersionRef.current += 1;
      collectLayers();
    };
    iframe.addEventListener("load", handleLoad);
    return () => iframe.removeEventListener("load", handleLoad);
  }, [previewIframeRef, collectLayers]);

  useEffect(() => {
    if (!compositionLoading) {
      const timer = setTimeout(collectLayers, 100);
      return () => clearTimeout(timer);
    }
  }, [compositionLoading, collectLayers]);

  const resolveSelection = useCallback(
    (layer: DomEditLayerItem) =>
      resolveDomEditSelection(layer.element, {
        activeCompositionPath: activeCompPath,
        isMasterView,
        preferClipAncestor: false,
      }),
    [activeCompPath, isMasterView],
  );

  const seekToLayer = useCallback(
    (layer: DomEditLayerItem) => {
      const selection = resolveSelection(layer);
      if (!selection) return;

      let matchedId = findMatchingTimelineElementId(selection, timelineElements);

      // No direct match — walk up DOM ancestors to find the nearest element
      // that has a timeline entry (e.g. a child of scene1 seeks to scene1.start)
      if (!matchedId) {
        const sourceFile = selection.sourceFile ?? "index.html";
        let ancestor = layer.element.parentElement;
        while (ancestor && !matchedId) {
          const elId = ancestor.id;
          if (elId) {
            const found = timelineElements.find(
              (e) => e.domId === elId && (e.sourceFile ?? "index.html") === sourceFile,
            );
            if (found) matchedId = found.key ?? found.id;
          }
          ancestor = ancestor.parentElement;
        }
      }

      if (matchedId) {
        const el = timelineElements.find((e) => (e.key ?? e.id) === matchedId);
        if (el) {
          usePlayerStore.getState().requestSeek(el.start + el.duration / 2);
        }
      }
    },
    [resolveSelection, timelineElements],
  );

  const handleSelectLayer = useCallback(
    (layer: DomEditLayerItem) => {
      const selection = resolveSelection(layer);
      if (!selection) return;
      applyDomSelection(selection);
      seekToLayer(layer);
    },
    [resolveSelection, applyDomSelection, seekToLayer],
  );

  const handleLayerHover = useCallback(
    (layer: DomEditLayerItem | null) => {
      if (!layer) {
        updateDomEditHoverSelection(null);
        return;
      }
      const selection = resolveSelection(layer);
      updateDomEditHoverSelection(selection);
    },
    [resolveSelection, updateDomEditHoverSelection],
  );

  const toggleCollapse = useCallback((key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const selectedKey = domEditSelection ? getDomEditLayerKey(domEditSelection) : null;

  const visibleLayers = getVisibleLayers(layers, collapsed);

  if (layers.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-neutral-900 px-6 text-center">
        <Layers size={18} className="mb-3 text-neutral-600" />
        <p className="text-sm font-medium text-neutral-200">No layers</p>
        <p className="mt-1 text-xs text-neutral-500">Load a composition to see its element tree</p>
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden bg-neutral-900"
      onPointerLeave={() => handleLayerHover(null)}
    >
      <div className="border-b border-white/10 px-3 py-2 text-[11px] text-neutral-500">
        {layers.length} layer{layers.length === 1 ? "" : "s"}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {visibleLayers.map((layer) => {
          const selected = layer.key === selectedKey;
          const isCollapsed = collapsed[layer.key] ?? false;
          const hasChildren = layer.childCount > 0;
          const isCompHost = isCompositionHost(layer.element);

          return (
            <div
              key={layer.key}
              role="button"
              tabIndex={0}
              onClick={() => handleSelectLayer(layer)}
              onPointerEnter={() => handleLayerHover(layer)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleSelectLayer(layer);
                }
              }}
              className={`group flex w-full cursor-pointer items-center gap-1.5 px-2 py-1 text-left transition-colors ${
                selected
                  ? "bg-studio-accent/14 text-studio-accent"
                  : "text-neutral-300 hover:bg-white/[0.04] hover:text-neutral-100"
              }`}
              style={{ paddingLeft: 8 + layer.depth * 16 }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  onClick={(e) => toggleCollapse(layer.key, e)}
                  className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-neutral-500 hover:text-neutral-300"
                >
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 8 8"
                    fill="currentColor"
                    className={`transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                  >
                    <path d="M2 1l4 3-4 3z" />
                  </svg>
                </button>
              ) : (
                <span className="w-4 flex-shrink-0" />
              )}
              <span
                className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[8px] font-bold uppercase ${
                  selected
                    ? "bg-studio-accent/18 text-studio-accent"
                    : isCompHost
                      ? "bg-blue-900/40 text-blue-400"
                      : "bg-neutral-800 text-neutral-500"
                }`}
              >
                {getTagBadge(layer.tagName)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px]">{layer.label}</span>
              {hasChildren && (
                <span className="text-[9px] tabular-nums text-neutral-600">{layer.childCount}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

function getVisibleLayers(
  layers: DomEditLayerItem[],
  collapsed: CollapsedState,
): DomEditLayerItem[] {
  if (Object.keys(collapsed).length === 0) return layers;

  const result: DomEditLayerItem[] = [];
  let skipDepth = -1;

  for (const layer of layers) {
    if (skipDepth >= 0 && layer.depth > skipDepth) continue;
    skipDepth = -1;

    result.push(layer);

    if (collapsed[layer.key] && layer.childCount > 0) {
      skipDepth = layer.depth;
    }
  }

  return result;
}
