import { memo, useState, useCallback, useEffect, useRef } from "react";
import {
  collectDomEditLayerItems,
  getDomEditLayerKey,
  resolveDomEditSelection,
  type DomEditLayerItem,
} from "./domEditing";
import { useStudioPlaybackContext, useStudioShellContext } from "../../contexts/StudioContext";
import { useDomEditContext } from "../../contexts/DomEditContext";
import { usePlayerStore } from "../../player";
import {
  findMatchingTimelineElementId,
  resolveTimelineSelectionSeekTime,
} from "../../utils/studioHelpers";
import { Layers } from "../../icons/SystemIcons";
import { useLayerDrag, isLayerDraggable, type LayerReorderEvent } from "./useLayerDrag";

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

// fallow-ignore-next-line complexity
export const LayersPanel = memo(function LayersPanel() {
  const { previewIframeRef, activeCompPath, showToast } = useStudioShellContext();
  const { refreshKey, compositionLoading, timelineElements } = useStudioPlaybackContext();
  const currentTime = usePlayerStore((s) => s.currentTime);
  const {
    domEditSelection,
    activeGroupElement,
    applyDomSelection,
    updateDomEditHoverSelection,
    handleDomZIndexReorderCommit,
    setActiveGroupElement,
  } = useDomEditContext();

  const [layers, setLayers] = useState<DomEditLayerItem[]>([]);
  const [collapsed, setCollapsed] = useState<CollapsedState>({});
  const prevDocVersionRef = useRef(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

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

    // A preview reload detaches the drilled-into wrapper; exit drill-in if so.
    if (activeGroupElement && !activeGroupElement.isConnected) setActiveGroupElement(null);

    const items = collectDomEditLayerItems(root, {
      activeCompositionPath: activeCompPath,
      isMasterView,
      activeGroupElement,
    });
    setLayers(sortLayersByZIndex(items));
  }, [previewIframeRef, activeCompPath, isMasterView, activeGroupElement, setActiveGroupElement]);

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
    (layer: DomEditLayerItem) => {
      // Re-find the element from the live DOM — layer.element may be stale
      // after soft reload (which replaces scripts without reloading the iframe).
      let el = layer.element;
      if (!el.isConnected) {
        const iframe = previewIframeRef.current;
        const doc = iframe?.contentDocument;
        if (doc) {
          const found =
            (layer.id ? doc.getElementById(layer.id) : null) ??
            (layer.hfId ? doc.querySelector(`[data-hf-id="${CSS.escape(layer.hfId)}"]`) : null) ??
            doc.getElementById(layer.key);
          if (found instanceof HTMLElement) el = found;
        }
      }
      return resolveDomEditSelection(el, {
        activeCompositionPath: activeCompPath,
        isMasterView,
        preferClipAncestor: false,
        activeGroupElement,
      });
    },
    [activeCompPath, isMasterView, previewIframeRef, activeGroupElement],
  );

  const seekToLayer = useCallback(
    async (layer: DomEditLayerItem) => {
      const selection = await resolveSelection(layer);
      if (!selection) return;

      let matchedId = findMatchingTimelineElementId(selection, timelineElements);

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
          const nextTime = resolveTimelineSelectionSeekTime(currentTime, el);
          if (nextTime != null) usePlayerStore.getState().requestSeek(nextTime);
        }
      }
    },
    [currentTime, resolveSelection, timelineElements],
  );

  const handleSelectLayer = useCallback(
    async (layer: DomEditLayerItem) => {
      const selection = await resolveSelection(layer);
      if (!selection) return;
      applyDomSelection(selection);
      await seekToLayer(layer);
    },
    [resolveSelection, applyDomSelection, seekToLayer],
  );

  // Double-click a group row → drill into it; any other row → select it.
  const handleLayerDoubleClick = useCallback(
    async (layer: DomEditLayerItem) => {
      const selection = await resolveSelection(layer);
      if (selection?.element.hasAttribute("data-hf-group")) {
        setActiveGroupElement(selection.element);
      } else {
        await handleSelectLayer(layer);
      }
    },
    [resolveSelection, setActiveGroupElement, handleSelectLayer],
  );

  const handleLayerHover = useCallback(
    async (layer: DomEditLayerItem | null) => {
      if (!layer) {
        updateDomEditHoverSelection(null);
        return;
      }
      const selection = await resolveSelection(layer);
      updateDomEditHoverSelection(selection);
    },
    [resolveSelection, updateDomEditHoverSelection],
  );

  const toggleCollapse = useCallback((key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleReorder = useCallback(
    (event: LayerReorderEvent) => {
      const { siblingLayers, fromIndex, toIndex } = event;
      const reordered = [...siblingLayers];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, moved);

      const existingValues = siblingLayers.map((l) => getElementZIndex(l.element));
      const sorted = [...existingValues].sort((a, b) => b - a);
      const hasDupes = sorted.some((v, i) => i > 0 && v === sorted[i - 1]);
      const zValues = hasDupes ? reordered.map((_, i) => reordered.length - i) : sorted;

      const entries = reordered.map((layer, i) => ({
        element: layer.element,
        zIndex: zValues[i],
        id: layer.id,
        selector: layer.selector,
        selectorIndex: layer.selectorIndex,
        sourceFile: layer.sourceFile,
      }));

      handleDomZIndexReorderCommit(entries);
    },
    [handleDomZIndexReorderCommit],
  );

  const selectedKey = domEditSelection ? getDomEditLayerKey(domEditSelection) : null;
  const visibleLayers = getVisibleLayers(layers, collapsed);

  const handleSingleSibling = useCallback(() => {
    showToast("Only one layer at this level", "info");
  }, [showToast]);

  const {
    dragKey,
    insertionLineY,
    handleRowPointerDown,
    handleContainerPointerMove,
    handleContainerPointerUp,
  } = useLayerDrag({
    visibleLayers,
    scrollContainerRef,
    onReorder: handleReorder,
    onSingleSibling: handleSingleSibling,
  });

  if (layers.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-panel-bg px-6 text-center">
        <Layers size={18} className="mb-3 text-panel-text-5" />
        <p className="text-sm font-medium text-panel-text-1">No layers</p>
        <p className="mt-1 text-xs text-neutral-500">Load a composition to see its element tree</p>
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden bg-panel-bg"
      onPointerLeave={() => handleLayerHover(null)}
    >
      <div className="border-b border-panel-border px-3 py-2 text-[11px] text-panel-text-3">
        {layers.length} layer{layers.length === 1 ? "" : "s"}
      </div>
      <div
        ref={scrollContainerRef}
        className="relative min-h-0 flex-1 overflow-y-auto py-1"
        onPointerMove={handleContainerPointerMove}
        onPointerUp={handleContainerPointerUp}
        onPointerCancel={handleContainerPointerUp}
      >
        {activeGroupElement && (
          <button
            type="button"
            onClick={() => setActiveGroupElement(null)}
            className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] text-panel-text-3 hover:bg-panel-hover/40 hover:text-panel-text-1"
          >
            <span aria-hidden="true">←</span>
            <span className="truncate">
              {activeGroupElement.getAttribute("data-hf-group") || "Group"}
            </span>
          </button>
        )}
        {visibleLayers.map((layer, index) => {
          const selected = layer.key === selectedKey;
          const isDragged = layer.key === dragKey;
          const draggable = isLayerDraggable(layer);
          const isCollapsed = collapsed[layer.key] ?? false;
          const hasChildren = layer.childCount > 0;
          const isCompHost = isCompositionHost(layer.element);

          return (
            <div
              key={layer.key}
              data-layer-index={index}
              role="button"
              tabIndex={0}
              onClick={() => !dragKey && handleSelectLayer(layer)}
              onDoubleClick={() => !dragKey && handleLayerDoubleClick(layer)}
              onPointerDown={(e) => handleRowPointerDown(index, e)}
              onPointerEnter={() => !dragKey && handleLayerHover(layer)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleSelectLayer(layer);
                }
              }}
              className={`group flex w-full items-center gap-1.5 px-2 py-1 text-left transition-colors ${
                isDragged
                  ? "opacity-40"
                  : selected
                    ? "bg-panel-accent/14 text-panel-accent"
                    : "text-panel-text-2 hover:bg-panel-hover/40 hover:text-panel-text-1"
              } ${dragKey ? "cursor-grabbing" : draggable ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}
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
                    ? "bg-panel-accent/18 text-panel-accent"
                    : isCompHost
                      ? "bg-panel-accent/40 text-panel-accent"
                      : "bg-panel-hover text-panel-text-4"
                }`}
              >
                {getTagBadge(layer.tagName)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px]">{layer.label}</span>
              {hasChildren && (
                <span className="text-[9px] tabular-nums text-panel-text-5">
                  {layer.childCount}
                </span>
              )}
            </div>
          );
        })}
        {insertionLineY != null && (
          <div
            className="pointer-events-none absolute left-2 right-2 h-0.5 bg-studio-accent"
            style={{ top: insertionLineY }}
          />
        )}
      </div>
    </div>
  );
});

// ── Pure helpers ──────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
function getElementZIndex(element: HTMLElement): number {
  try {
    const inline = element.style?.zIndex;
    if (inline && inline !== "auto") {
      const parsed = parseInt(inline, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
    const win = element.ownerDocument?.defaultView;
    if (!win) return 0;
    const value = win.getComputedStyle(element).zIndex;
    if (value === "auto" || value === "") return 0;
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

// fallow-ignore-next-line complexity
export function sortLayersByZIndex(layers: DomEditLayerItem[]): DomEditLayerItem[] {
  if (layers.length <= 1) return layers;

  const minDepth = layers[0].depth;
  for (let i = 1; i < layers.length; i++) {
    if (layers[i].depth < minDepth) return layers;
  }

  const chunks: Array<{ root: DomEditLayerItem; children: DomEditLayerItem[]; domIndex: number }> =
    [];

  for (let i = 0; i < layers.length; i++) {
    if (layers[i].depth === minDepth) {
      const children: DomEditLayerItem[] = [];
      let j = i + 1;
      while (j < layers.length && layers[j].depth > minDepth) {
        children.push(layers[j]);
        j++;
      }
      chunks.push({ root: layers[i], children, domIndex: chunks.length });
    }
  }

  if (chunks.length <= 1) {
    if (chunks.length === 1 && chunks[0].children.length > 0) {
      const sorted = sortLayersByZIndex(chunks[0].children);
      return [chunks[0].root, ...sorted];
    }
    return layers;
  }

  chunks.sort((a, b) => {
    const zA = getElementZIndex(a.root.element);
    const zB = getElementZIndex(b.root.element);
    if (zA !== zB) return zB - zA;
    return b.domIndex - a.domIndex;
  });

  const result: DomEditLayerItem[] = [];
  for (const chunk of chunks) {
    result.push(chunk.root);
    if (chunk.children.length > 0) {
      result.push(...sortLayersByZIndex(chunk.children));
    }
  }
  return result;
}

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
