import { memo, useState, useCallback, useEffect, useRef } from "react";
import {
  collectDomEditLayerItems,
  getDomEditLayerKey,
  resolveDomEditSelection,
  type DomEditLayerItem,
} from "./domEditing";
import { useStudioContext } from "../../contexts/StudioContext";
import { useDomEditContext } from "../../contexts/DomEditContext";
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

const TEXT_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "a", "li", "button"]);
const MEDIA_TAGS = new Set(["img", "video", "canvas", "svg"]);

interface ElementPreviewInfo {
  bgColor: string;
  textColor: string;
  textSnippet: string;
  isMedia: boolean;
  isText: boolean;
  hasBorder: boolean;
  borderColor: string;
  imgSrc: string | null;
}

function getElementPreviewInfo(el: HTMLElement): ElementPreviewInfo {
  const win = el.ownerDocument.defaultView;
  const computed = win?.getComputedStyle(el);
  const tag = el.tagName.toLowerCase();

  const bgColor = computed?.backgroundColor ?? "transparent";
  const textColor = computed?.color ?? "#fff";
  const borderWidth = parseFloat(computed?.borderWidth ?? "0");
  const hasBorder = borderWidth > 0;
  const borderColor = computed?.borderColor ?? "transparent";
  const isMedia = MEDIA_TAGS.has(tag);
  const isText = TEXT_TAGS.has(tag);

  let textSnippet = "";
  if (isText) {
    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const t = (node.textContent ?? "").trim();
      if (t) {
        textSnippet = t.slice(0, 12);
        break;
      }
    }
  }

  let imgSrc: string | null = null;
  if (tag === "img") {
    imgSrc = el.getAttribute("src");
  }

  return { bgColor, textColor, textSnippet, isMedia, isText, hasBorder, borderColor, imgSrc };
}

function isTransparentOrNone(color: string): boolean {
  return (
    color === "transparent" || color === "rgba(0, 0, 0, 0)" || color === "none" || color === ""
  );
}

function LayerPreview({ el, selected }: { el: HTMLElement; selected: boolean }) {
  const info = getElementPreviewInfo(el);
  const hasBg = !isTransparentOrNone(info.bgColor);
  const hasBorderVisible = info.hasBorder && !isTransparentOrNone(info.borderColor);

  if (info.imgSrc) {
    return (
      <span
        className="flex-shrink-0 overflow-hidden rounded"
        style={{
          width: 28,
          height: 20,
          backgroundImage: `url(${info.imgSrc})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          border: "1px solid rgba(255,255,255,0.1)",
        }}
      />
    );
  }

  if (info.isText && info.textSnippet) {
    return (
      <span
        className="flex flex-shrink-0 items-center justify-center overflow-hidden rounded"
        style={{
          width: 28,
          height: 20,
          backgroundColor: hasBg ? info.bgColor : "rgba(255,255,255,0.06)",
          border: hasBorderVisible
            ? `1px solid ${info.borderColor}`
            : "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <span
          style={{
            color: info.textColor,
            fontSize: 7,
            lineHeight: 1,
            fontWeight: 600,
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          {info.textSnippet}
        </span>
      </span>
    );
  }

  if (info.isMedia) {
    return (
      <span
        className="flex flex-shrink-0 items-center justify-center rounded"
        style={{
          width: 28,
          height: 20,
          backgroundColor: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke={selected ? "currentColor" : "#666"}
          strokeWidth="1.5"
        >
          <rect x="2" y="2" width="20" height="20" rx="2" />
          <circle cx="8" cy="8" r="2" />
          <path d="m21 15-5-5L5 21" />
        </svg>
      </span>
    );
  }

  return (
    <span
      className="flex-shrink-0 rounded"
      style={{
        width: 28,
        height: 20,
        backgroundColor: hasBg ? info.bgColor : "rgba(255,255,255,0.04)",
        border: hasBorderVisible
          ? `1px solid ${info.borderColor}`
          : hasBg
            ? "1px solid rgba(255,255,255,0.1)"
            : "1px dashed rgba(255,255,255,0.12)",
      }}
    />
  );
}

interface CollapsedState {
  [key: string]: boolean;
}

export const LayersPanel = memo(function LayersPanel() {
  const { previewIframeRef, activeCompPath, refreshKey, compositionLoading } = useStudioContext();
  const { domEditSelection, applyDomSelection } = useDomEditContext();

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

  const handleSelectLayer = useCallback(
    (layer: DomEditLayerItem) => {
      const selection = resolveDomEditSelection(layer.element, {
        activeCompositionPath: activeCompPath,
        isMasterView,
        preferClipAncestor: false,
      });
      if (selection) applyDomSelection(selection);
    },
    [activeCompPath, isMasterView, applyDomSelection],
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-neutral-900">
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
              <LayerPreview el={layer.element} selected={selected} />
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
