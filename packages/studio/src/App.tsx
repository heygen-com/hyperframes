import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useMountEffect } from "./hooks/useMountEffect";
import { NLELayout } from "./components/nle/NLELayout";
import { SourceEditor } from "./components/editor/SourceEditor";
import { LeftSidebar } from "./components/sidebar/LeftSidebar";
import { RenderQueue } from "./components/renders/RenderQueue";
import { useRenderQueue } from "./components/renders/useRenderQueue";
import { CompositionThumbnail, VideoThumbnail, liveTime, usePlayerStore } from "./player";
import { AudioWaveform } from "./player/components/AudioWaveform";
import type { TimelineElement } from "./player";
import { LintModal } from "./components/LintModal";
import type { LintFinding } from "./components/LintModal";
import { MediaPreview } from "./components/MediaPreview";
import { RotateCcw, RotateCw } from "./icons/SystemIcons";
import { FONT_EXT, isMediaFile } from "./utils/mediaTypes";
import {
  buildTimelineAssetId,
  buildTimelineAssetInsertHtml,
  buildTimelineFileDropPlacements,
  getTimelineAssetKind,
  insertTimelineAssetIntoSource,
  resolveTimelineAssetInitialGeometry,
  resolveTimelineAssetSrc,
  type TimelineAssetKind,
} from "./utils/timelineAssetDrop";
import { CaptionOverlay } from "./captions/components/CaptionOverlay";
import { CaptionPropertyPanel } from "./captions/components/CaptionPropertyPanel";
import { CaptionTimeline } from "./captions/components/CaptionTimeline";
import { useCaptionStore } from "./captions/store";
import { useCaptionSync } from "./captions/hooks/useCaptionSync";
import { parseCaptionComposition } from "./captions/parser";
import { copyTextToClipboard } from "./utils/clipboard";
import { usePersistentEditHistory } from "./hooks/usePersistentEditHistory";
import {
  applyPatchByTarget,
  readAttributeByTarget,
  readTagSnippetByTarget,
  type PatchOperation,
} from "./utils/sourcePatcher";
import {
  buildTrackZIndexMap,
  formatTimelineAttributeNumber,
} from "./player/components/timelineEditing";
import {
  getNextTimelineZoomPercent,
  getTimelineZoomPercent,
} from "./player/components/timelineZoom";
import {
  TIMELINE_TOGGLE_SHORTCUT_LABEL,
  getTimelineEditorHintDismissed,
  getTimelineToggleTitle,
  setTimelineEditorHintDismissed,
  shouldHandleTimelineToggleHotkey,
} from "./utils/timelineDiscovery";
import { buildFrameCaptureFilename, buildFrameCaptureUrl } from "./utils/frameCapture";
import { buildProjectHash, parseProjectIdFromHash } from "./utils/projectRouting";
import { Camera } from "./icons/SystemIcons";
import { PropertyPanel } from "./components/editor/PropertyPanel";
import { googleFontStylesheetUrl } from "./components/editor/fontCatalog";
import {
  fontFamilyFromAssetPath,
  importedFontFaceCss,
  type ImportedFontAsset,
} from "./components/editor/fontAssets";
import {
  DomEditOverlay,
  type DomEditGroupPathOffsetCommit,
} from "./components/editor/DomEditOverlay";
import {
  buildDefaultDomEditTextField,
  buildDomEditStylePatchOperation,
  buildDomEditTextPatchOperation,
  buildElementAgentPrompt,
  findElementForSelection,
  getDomEditTargetKey,
  isTextEditableSelection,
  serializeDomEditTextFields,
  resolveDomEditSelection,
  type DomEditTextField,
  type DomEditSelection,
} from "./components/editor/domEditing";
import {
  STUDIO_MANUAL_EDITS_PATH,
  applyStudioManualEditManifest,
  emptyStudioManualEditManifest,
  installStudioManualEditSeekReapply,
  isStudioManualEditManifestPath,
  parseStudioManualEditManifest,
  readStudioFileChangePath,
  removeStudioManualEditsForSelection,
  serializeStudioManualEditManifest,
  type StudioManualEditManifest,
  upsertStudioBoxSizeEdit,
  upsertStudioPathOffsetEdit,
  upsertStudioRotationEdit,
} from "./components/editor/manualEdits";
import { saveProjectFilesWithHistory } from "./utils/studioFileHistory";

interface EditingFile {
  path: string;
  content: string | null;
}

interface AppToast {
  message: string;
  tone: "error" | "info";
}

function getTimelineElementLabel(element: TimelineElement): string {
  return element.label || element.id || element.tag;
}

type RightPanelTab = "design" | "renders";

const GENERIC_FONT_FAMILIES = new Set([
  "inherit",
  "initial",
  "revert",
  "revert-layer",
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
  "fangsong",
]);

function primaryFontFamilyFromCss(value: string): string {
  const first = value.split(",")[0] ?? "";
  return first.trim().replace(/^["']|["']$/g, "");
}

function injectPreviewGoogleFont(doc: Document, fontFamilyValue: string): void {
  const family = primaryFontFamilyFromCss(fontFamilyValue);
  if (!family || GENERIC_FONT_FAMILIES.has(family.toLowerCase())) return;

  const id = `studio-preview-google-font-${family.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  if (doc.getElementById(id)) return;

  const link = doc.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = googleFontStylesheetUrl(family);
  doc.head.appendChild(link);
}

function primaryFontFamilyValue(value: string): string {
  return (
    value
      .split(",")[0]
      ?.trim()
      .replace(/^["']|["']$/g, "")
      .trim() ?? ""
  );
}

function injectPreviewImportedFont(doc: Document, asset: ImportedFontAsset): void {
  const id = `studio-imported-font-${asset.family.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  if (doc.getElementById(id)) return;
  const style = doc.createElement("style");
  style.id = id;
  style.textContent = importedFontFaceCss(asset);
  doc.head.appendChild(style);
}

function normalizeProjectAssetPath(value: string): string {
  const trimmed = value.trim();
  const maybeUrl = /^[a-z]+:\/\//i.test(trimmed) ? new URL(trimmed).pathname : trimmed;
  return decodeURIComponent(maybeUrl)
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "");
}

function toRelativeProjectAssetPath(sourceFile: string, assetPath: string): string {
  const fromParts = normalizeProjectAssetPath(sourceFile).split("/").filter(Boolean);
  const targetParts = normalizeProjectAssetPath(assetPath).split("/").filter(Boolean);

  fromParts.pop();

  while (fromParts.length > 0 && targetParts.length > 0 && fromParts[0] === targetParts[0]) {
    fromParts.shift();
    targetParts.shift();
  }

  return [...fromParts.map(() => ".."), ...targetParts].join("/") || assetPath;
}

function isAbsoluteFilePath(value: string): boolean {
  return /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(value);
}

function toProjectAbsolutePath(projectDir: string | null, sourceFile: string): string | undefined {
  const trimmedSource = sourceFile.trim();
  if (!trimmedSource) return undefined;

  const normalizedSource = trimmedSource.replace(/\\/g, "/");
  if (isAbsoluteFilePath(normalizedSource)) return normalizedSource;

  const normalizedRoot = projectDir?.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalizedRoot) return undefined;

  return `${normalizedRoot}/${normalizedSource.replace(/^\.?\//, "")}`;
}

function ensureImportedFontFace(
  html: string,
  asset: ImportedFontAsset,
  sourceFile: string,
): string {
  const css = importedFontFaceCss(asset, toRelativeProjectAssetPath(sourceFile, asset.path));
  if (html.includes(css)) return html;

  const styleRe = /<style\b[^>]*data-hf-studio-fonts=(["'])true\1[^>]*>([\s\S]*?)<\/style>/i;
  const styleMatch = styleRe.exec(html);
  if (styleMatch) {
    const nextCss = `${styleMatch[2].trim()}\n${css}`.trim();
    return html.replace(styleMatch[0], `<style data-hf-studio-fonts="true">\n${nextCss}\n</style>`);
  }

  const styleTag = `<style data-hf-studio-fonts="true">\n${css}\n</style>`;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `  ${styleTag}\n  </head>`);
  }
  return `${styleTag}\n${html}`;
}
function normalizeDomEditStyleValue(property: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  if (["border-radius", "font-size"].includes(property) && /^-?\d+(\.\d+)?$/.test(trimmed)) {
    return `${trimmed}px`;
  }

  return trimmed;
}

function isImageBackgroundValue(value: string): boolean {
  return /^url\(/i.test(value.trim());
}

function getEventTargetElement(target: EventTarget | null): HTMLElement | null {
  if (!target || typeof target !== "object") return null;
  const maybeNode = target as {
    nodeType?: number;
    parentElement?: Element | null;
  };
  if (maybeNode.nodeType === 1) return target as HTMLElement;
  if (maybeNode.nodeType === 3 && maybeNode.parentElement) {
    return maybeNode.parentElement as HTMLElement;
  }
  return null;
}

function shouldIgnoreHistoryShortcut(target: EventTarget | null): boolean {
  const el = getEventTargetElement(target);
  if (!el) return false;
  return Boolean(
    el.closest("input, textarea, select, [contenteditable='true'], [role='textbox'], .cm-editor"),
  );
}

function getHistoryShortcutLabel(action: "undo" | "redo"): string {
  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
  const modifier = isMac ? "Cmd" : "Ctrl";
  return action === "undo" ? `${modifier}+Z` : `${modifier}+Shift+Z`;
}

function findMatchingTimelineElementId(
  selection: Pick<
    DomEditSelection,
    "id" | "selector" | "selectorIndex" | "sourceFile" | "compositionSrc" | "isCompositionHost"
  >,
  elements: TimelineElement[],
): string | null {
  const selectionSourceFile = selection.sourceFile || "index.html";
  for (const element of elements) {
    const elementSourceFile = element.sourceFile || "index.html";
    if (
      selection.id &&
      element.domId === selection.id &&
      elementSourceFile === selectionSourceFile
    ) {
      return element.key ?? element.id;
    }
    if (
      selection.isCompositionHost &&
      selection.compositionSrc &&
      element.compositionSrc === selection.compositionSrc
    ) {
      return element.key ?? element.id;
    }
    if (
      selection.selector &&
      element.selector === selection.selector &&
      (element.selectorIndex ?? 0) === (selection.selectorIndex ?? 0) &&
      (element.sourceFile ?? "index.html") === selection.sourceFile
    ) {
      return element.key ?? element.id;
    }
  }

  return null;
}

function isManualGeometryStyleProperty(property: string): boolean {
  return property === "left" || property === "top" || property === "width" || property === "height";
}

function getPreviewTargetFromPointer(
  iframe: HTMLIFrameElement,
  clientX: number,
  clientY: number,
): HTMLElement | null {
  let doc: Document | null = null;
  let win: Window | null = null;
  try {
    doc = iframe.contentDocument;
    win = iframe.contentWindow;
  } catch {
    return null;
  }
  if (!doc || !win) return null;

  const iframeRect = iframe.getBoundingClientRect();
  const root =
    doc.querySelector<HTMLElement>("[data-composition-id]") ?? doc.documentElement ?? null;
  const rootRect = root?.getBoundingClientRect();
  const rootWidth = rootRect?.width || win.innerWidth;
  const rootHeight = rootRect?.height || win.innerHeight;
  if (!rootWidth || !rootHeight) return null;

  const scaleX = iframeRect.width / rootWidth;
  const scaleY = iframeRect.height / rootHeight;
  const localX = (clientX - iframeRect.left) / scaleX;
  const localY = (clientY - iframeRect.top) / scaleY;

  return getEventTargetElement(doc.elementFromPoint(localX, localY));
}

function domEditSelectionsTargetSame(
  a: DomEditSelection | null,
  b: DomEditSelection | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return getDomEditTargetKey(a) === getDomEditTargetKey(b);
}

function domEditSelectionInGroup(
  group: DomEditSelection[],
  selection: DomEditSelection | null,
): boolean {
  if (!selection) return false;
  return group.some((entry) => domEditSelectionsTargetSame(entry, selection));
}

function toggleDomEditGroupSelection(
  group: DomEditSelection[],
  selection: DomEditSelection,
): DomEditSelection[] {
  if (domEditSelectionInGroup(group, selection)) {
    return group.filter((entry) => !domEditSelectionsTargetSame(entry, selection));
  }
  return [...group, selection];
}

function replaceDomEditGroupSelection(
  group: DomEditSelection[],
  selection: DomEditSelection,
): DomEditSelection[] {
  let replaced = false;
  const nextGroup = group.map((entry) => {
    if (!domEditSelectionsTargetSame(entry, selection)) return entry;
    replaced = true;
    return selection;
  });
  return replaced ? nextGroup : [...group, selection];
}

function seedDomEditGroupWithSelection(
  group: DomEditSelection[],
  selection: DomEditSelection | null,
): DomEditSelection[] {
  if (!selection || domEditSelectionInGroup(group, selection)) return group;
  return [selection, ...group];
}

function objectLike(value: unknown): object | null {
  return value && (typeof value === "object" || typeof value === "function") ? value : null;
}

function callPlaybackMethod(target: object | null, key: string): void {
  const method = target ? Reflect.get(target, key) : null;
  if (typeof method !== "function") return;
  try {
    method.call(target);
  } catch {
    // Best-effort playback freeze; drag should still work if playback control is unavailable.
  }
}

function readPlaybackTime(target: object | null, key: string): number | null {
  const method = target ? Reflect.get(target, key) : null;
  if (typeof method !== "function") return null;
  try {
    const value = method.call(target);
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function pauseStudioPreviewPlayback(iframe: HTMLIFrameElement | null): number | null {
  const win = iframe?.contentWindow;
  if (!win) return null;

  try {
    let pausedTime: number | null = null;
    const player = objectLike(Reflect.get(win, "__player"));
    pausedTime = readPlaybackTime(player, "getTime") ?? pausedTime;
    callPlaybackMethod(player, "pause");

    const timeline = objectLike(Reflect.get(win, "__timeline"));
    pausedTime = pausedTime ?? readPlaybackTime(timeline, "time");
    callPlaybackMethod(timeline, "pause");

    const timelines = objectLike(Reflect.get(win, "__timelines"));
    if (timelines) {
      for (const value of Object.values(timelines)) {
        const timelineRecord = objectLike(value);
        pausedTime = pausedTime ?? readPlaybackTime(timelineRecord, "time");
        callPlaybackMethod(timelineRecord, "pause");
      }
    }

    return pausedTime;
  } catch {
    return null;
  }
}

// ── Ask Agent Modal ──

function AskAgentModal({
  selectionLabel,
  onSubmit,
  onClose,
}: {
  selectionLabel: string;
  onSubmit: (instruction: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useMountEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  });

  const handleSubmit = () => {
    if (!value.trim()) return;
    onSubmit(value.trim());
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[480px] rounded-2xl border border-neutral-800 bg-neutral-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800/60">
          <div>
            <h3 className="text-sm font-medium text-neutral-200">Ask agent</h3>
            <p className="text-xs text-neutral-500 mt-0.5">
              {selectionLabel.length > 50 ? `${selectionLabel.slice(0, 49)}…` : selectionLabel}
            </p>
          </div>
          <button
            className="p-1 rounded-md text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/50"
            onClick={onClose}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-4">
          <textarea
            ref={inputRef}
            className="w-full h-24 px-3 py-2 rounded-lg border border-neutral-800 bg-neutral-900/60 text-sm text-neutral-200 placeholder-neutral-600 resize-none focus:outline-none focus:border-studio-accent/60 focus:ring-1 focus:ring-studio-accent/30"
            placeholder="Describe what you want to change…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit();
              if (e.key === "Escape") onClose();
            }}
          />
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t border-neutral-800/60">
          <span className="text-[11px] text-neutral-600">
            {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}+Enter to copy
          </span>
          <button
            className="px-4 py-1.5 rounded-lg bg-studio-accent/90 text-xs font-medium text-neutral-950 hover:bg-studio-accent disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={!value.trim()}
            onClick={handleSubmit}
          >
            Copy prompt
          </button>
        </div>
      </div>
    </div>
  );
}

const DEFAULT_TIMELINE_ASSET_DURATION: Record<TimelineAssetKind, number> = {
  image: 3,
  video: 5,
  audio: 5,
};

function collectHtmlIds(source: string): string[] {
  return Array.from(source.matchAll(/\bid="([^"]+)"/g), (match) => match[1] ?? "");
}

async function resolveDroppedAssetDuration(
  projectId: string,
  assetPath: string,
  kind: TimelineAssetKind,
): Promise<number> {
  if (kind === "image") return DEFAULT_TIMELINE_ASSET_DURATION.image;

  const media = document.createElement(kind === "video" ? "video" : "audio");
  media.preload = "metadata";
  media.src = `/api/projects/${projectId}/preview/${assetPath}`;

  const duration = await new Promise<number>((resolve) => {
    const timeout = window.setTimeout(() => resolve(DEFAULT_TIMELINE_ASSET_DURATION[kind]), 3000);
    const finalize = (value: number) => {
      window.clearTimeout(timeout);
      resolve(value);
    };

    media.addEventListener(
      "loadedmetadata",
      () => {
        const raw = Number(media.duration);
        finalize(
          Number.isFinite(raw) && raw > 0
            ? Math.round(raw * 100) / 100
            : DEFAULT_TIMELINE_ASSET_DURATION[kind],
        );
      },
      { once: true },
    );
    media.addEventListener("error", () => finalize(DEFAULT_TIMELINE_ASSET_DURATION[kind]), {
      once: true,
    });
  });

  media.src = "";
  media.load();
  return duration;
}

// ── Main App ──

export function StudioApp() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);

  useMountEffect(() => {
    const hashProjectId = parseProjectIdFromHash(window.location.hash);
    if (hashProjectId) {
      setProjectId(hashProjectId);
      setResolving(false);
      return;
    }
    // No hash — auto-select first available project
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => {
        const first = (data.projects ?? [])[0];
        if (first) {
          setProjectId(first.id);
          window.location.hash = buildProjectHash(first.id);
        }
      })
      .catch(() => {})
      .finally(() => setResolving(false));
  });

  const [editingFile, setEditingFile] = useState<EditingFile | null>(null);
  const [projectDir, setProjectDir] = useState<string | null>(null);
  const [activeCompPath, setActiveCompPath] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<string[]>([]);
  const [compIdToSrc, setCompIdToSrc] = useState<Map<string, string>>(new Map());
  const renderQueue = useRenderQueue(projectId);
  const captionEditMode = useCaptionStore((s) => s.isEditMode);
  const captionHasSelection = useCaptionStore((s) => s.selectedSegmentIds.size > 0);
  const captionSync = useCaptionSync(projectId);

  // Resizable and collapsible panel widths
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(400);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(true);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>("renders");
  const [domEditSelection, setDomEditSelection] = useState<DomEditSelection | null>(null);
  const [domEditGroupSelections, setDomEditGroupSelections] = useState<DomEditSelection[]>([]);
  const [domEditHoverSelection, setDomEditHoverSelection] = useState<DomEditSelection | null>(null);
  const [agentPromptTagSnippet, setAgentPromptTagSnippet] = useState<string | undefined>();
  const [copiedAgentPrompt, setCopiedAgentPrompt] = useState(false);
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [previewIframe, setPreviewIframe] = useState<HTMLIFrameElement | null>(null);
  // Auto-enter caption edit mode when the iframe contains .caption-group elements.
  // This is a subscription to external events (postMessage from runtime) — useEffect
  // is appropriate here. The runtime fires "state"/"timeline" messages after all
  // compositions load, which triggers caption detection.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!projectId) return;

    let activating = false;

    const tryActivateCaptions = () => {
      if (useCaptionStore.getState().isEditMode || activating) {
        return;
      }

      const iframe = previewIframeRef.current;
      let doc: Document | null = null;
      let win: Window | null = null;
      try {
        doc = iframe?.contentDocument ?? null;
        win = iframe?.contentWindow ?? null;
      } catch {
        return;
      }
      if (!doc || !win) return;

      const groups = doc.querySelectorAll(".caption-group");
      if (groups.length === 0) return;

      // Find the captions composition source path.
      // The runtime strips data-composition-src after loading, so also check
      // data-composition-file (set by the bundler) and the compIdToSrc map.
      let captionSrcPath: string | null = null;

      // Strategy 1: data-composition-src or data-composition-file attributes
      const compHosts = doc.querySelectorAll("[data-composition-src], [data-composition-file]");
      for (const host of compHosts) {
        const src =
          host.getAttribute("data-composition-src") || host.getAttribute("data-composition-file");
        if (src && src.includes("captions")) {
          captionSrcPath = src;
          break;
        }
      }

      // Strategy 2: compIdToSrc map (built from raw index.html before runtime strips attrs)
      if (!captionSrcPath) {
        for (const [id, src] of compIdToSrc) {
          if (id.includes("caption") || src.includes("caption")) {
            captionSrcPath = src;
            break;
          }
        }
      }

      // Strategy 3: activeCompPath if viewing captions directly
      if (!captionSrcPath && activeCompPath?.includes("captions")) {
        captionSrcPath = activeCompPath;
      }

      // Strategy 4: find composition element with "caption" in its ID
      if (!captionSrcPath) {
        const captionComp = doc.querySelector('[data-composition-id*="caption"]');
        if (captionComp) {
          const compId = captionComp.getAttribute("data-composition-id") || "";
          captionSrcPath = compIdToSrc.get(compId) || null;
        }
      }

      if (!captionSrcPath) return;

      activating = true;
      const srcPath = captionSrcPath;
      fetch(`/api/projects/${projectId}/files/${encodeURIComponent(srcPath)}`)
        .then((r) => r.json())
        .then((data: { content?: string }) => {
          if (!data.content || !doc || !win || useCaptionStore.getState().isEditMode) return;
          const root = doc.querySelector("[data-composition-id]");
          const w = parseInt(root?.getAttribute("data-width") ?? "1920", 10);
          const h = parseInt(root?.getAttribute("data-height") ?? "1080", 10);
          const dur = parseFloat(root?.getAttribute("data-duration") ?? "0");
          const model = parseCaptionComposition(doc, win, data.content, w, h, dur);
          if (!model) return;
          const store = useCaptionStore.getState();
          store.setModel(model);
          store.setSourceFilePath(srcPath);
          store.setEditMode(true);
          captionSync.loadOverrides();
        })
        .catch(() => {})
        .finally(() => {
          activating = false;
        });
    };

    // Listen for runtime messages that signal composition loading is complete
    const handleMessage = (e: MessageEvent) => {
      const data = e.data;
      if (data?.source === "hf-preview" && (data?.type === "state" || data?.type === "timeline")) {
        tryActivateCaptions();
      }
    };

    window.addEventListener("message", handleMessage);
    // Try immediately in case compositions are already loaded
    tryActivateCaptions();

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [activeCompPath, projectId, compIdToSrc, captionSync]);

  // Auto-expand right panel when a caption word is selected
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (captionEditMode) {
      setRightCollapsed(!captionHasSelection);
    }
  }, [captionHasSelection, captionEditMode]);
  const [globalDragOver, setGlobalDragOver] = useState(false);
  const [appToast, setAppToast] = useState<AppToast | null>(null);
  const [timelineVisible, setTimelineVisible] = useState(true);
  const [captureFrameTime, setCaptureFrameTime] = useState(0);
  const [timelineEditorHintDismissed, setTimelineEditorHintState] = useState(
    getTimelineEditorHintDismissed,
  );
  const dragCounterRef = useRef(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBlockedTimelineToastAtRef = useRef(0);
  const lastBlockedDomMoveToastAtRef = useRef(0);
  const importedFontAssetsRef = useRef<ImportedFontAsset[]>([]);
  const previewHotkeyWindowRef = useRef<Window | null>(null);
  const previewHistoryHotkeyCleanupRef = useRef<(() => void) | null>(null);
  const panelDragRef = useRef<{
    side: "left" | "right";
    startX: number;
    startW: number;
  } | null>(null);

  // Derive active preview URL from composition path (for drilled-down thumbnails)
  const activePreviewUrl = activeCompPath
    ? `/api/projects/${projectId}/preview/comp/${activeCompPath}`
    : null;
  const isMasterView = !activeCompPath || activeCompPath === "index.html";
  const zoomMode = usePlayerStore((s) => s.zoomMode);
  const manualZoomPercent = usePlayerStore((s) => s.manualZoomPercent);
  const setZoomMode = usePlayerStore((s) => s.setZoomMode);
  const setManualZoomPercent = usePlayerStore((s) => s.setManualZoomPercent);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const timelineElements = usePlayerStore((s) => s.elements);
  const setSelectedTimelineElementId = usePlayerStore((s) => s.setSelectedElementId);
  const timelineDuration = usePlayerStore((s) => s.duration);
  const effectiveTimelineDuration = useMemo(() => {
    const maxEnd =
      timelineElements.length > 0
        ? Math.max(...timelineElements.map((element) => element.start + element.duration))
        : 0;
    return Math.max(timelineDuration, maxEnd);
  }, [timelineDuration, timelineElements]);
  const displayedTimelineZoomPercent = useMemo(
    () => getTimelineZoomPercent(zoomMode, manualZoomPercent),
    [zoomMode, manualZoomPercent],
  );
  const toggleTimelineVisibility = useCallback(() => {
    setTimelineVisible((visible) => !visible);
  }, []);
  const toggleLeftSidebar = useCallback(() => {
    setLeftCollapsed((collapsed) => !collapsed);
  }, []);
  const refreshCaptureFrameTime = useCallback(() => {
    setCaptureFrameTime(usePlayerStore.getState().currentTime);
  }, []);

  useMountEffect(() => {
    setCaptureFrameTime(usePlayerStore.getState().currentTime);
    return liveTime.subscribe(setCaptureFrameTime);
  });

  const captureFrameHref = projectId
    ? buildFrameCaptureUrl({
        projectId,
        compositionPath: activeCompPath,
        currentTime: captureFrameTime,
      })
    : "#";
  const captureFrameFilename = buildFrameCaptureFilename(activeCompPath, captureFrameTime);
  useMountEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  });
  const dismissTimelineEditorHint = useCallback(() => {
    setTimelineEditorHintState(true);
    setTimelineEditorHintDismissed(true);
  }, []);
  const handleTimelineToggleHotkey = useCallback(
    (event: KeyboardEvent) => {
      if (!shouldHandleTimelineToggleHotkey(event)) return;
      event.preventDefault();
      toggleTimelineVisibility();
    },
    [toggleTimelineVisibility],
  );

  useMountEffect(() => {
    window.addEventListener("keydown", handleTimelineToggleHotkey);
    return () => {
      window.removeEventListener("keydown", handleTimelineToggleHotkey);
    };
  });

  const syncPreviewTimelineHotkey = useCallback(
    (iframe: HTMLIFrameElement | null) => {
      const nextWindow = iframe?.contentWindow ?? null;
      if (previewHotkeyWindowRef.current === nextWindow) return;
      if (previewHotkeyWindowRef.current) {
        previewHotkeyWindowRef.current.removeEventListener("keydown", handleTimelineToggleHotkey);
      }
      previewHotkeyWindowRef.current = nextWindow;
      nextWindow?.addEventListener("keydown", handleTimelineToggleHotkey);
    },
    [handleTimelineToggleHotkey],
  );

  useEffect(
    () => () => {
      if (previewHotkeyWindowRef.current) {
        previewHotkeyWindowRef.current.removeEventListener("keydown", handleTimelineToggleHotkey);
        previewHotkeyWindowRef.current = null;
      }
    },
    [handleTimelineToggleHotkey],
  );

  const renderClipContent = useCallback(
    (el: TimelineElement, style: { clip: string; label: string }): ReactNode => {
      const pid = projectIdRef.current;
      if (!pid) return null;

      // Resolve composition source path using the compIdToSrc map
      let compSrc = el.compositionSrc;
      if (compSrc && compIdToSrc.size > 0) {
        const resolved =
          compIdToSrc.get(el.id) ||
          compIdToSrc.get(compSrc.replace(/^compositions\//, "").replace(/\.html$/, ""));
        if (resolved) compSrc = resolved;
      }

      // Composition clips — always use the comp's own preview URL for thumbnails.
      // This renders the composition in isolation so we get clean frames
      // instead of capturing the master at a time when the comp is fading in.
      if (compSrc) {
        return (
          <CompositionThumbnail
            previewUrl={`/api/projects/${pid}/preview/comp/${compSrc}`}
            label={getTimelineElementLabel(el)}
            labelColor={style.label}
            accentColor={style.clip}
            seekTime={0}
            duration={el.duration}
          />
        );
      }

      // When drilled into a composition, render all inner elements via
      // CompositionThumbnail at their start time — most accurate visual.
      if (activePreviewUrl && el.duration > 0) {
        return (
          <CompositionThumbnail
            previewUrl={activePreviewUrl}
            label={getTimelineElementLabel(el)}
            labelColor={style.label}
            accentColor={style.clip}
            selector={el.selector}
            selectorIndex={el.selectorIndex}
            seekTime={el.start}
            duration={el.duration}
          />
        );
      }

      const htmlPreviewEligible =
        el.duration > 0 &&
        effectiveTimelineDuration > 0 &&
        el.duration < effectiveTimelineDuration * 0.92 &&
        !/(backdrop|background|overlay|scrim|mask)/i.test(el.id);

      // Audio clips — waveform visualization
      if (el.tag === "audio") {
        const previewBase = `/api/projects/${pid}/preview/`;
        const previewIdx = el.src?.startsWith("http") ? el.src.indexOf(previewBase) : -1;
        const srcRelative = el.src
          ? previewIdx !== -1
            ? decodeURIComponent(el.src.slice(previewIdx + previewBase.length))
            : el.src.startsWith("http")
              ? null
              : el.src
          : null;
        const audioUrl = srcRelative
          ? `/api/projects/${pid}/preview/${srcRelative}`
          : (el.src ?? "");
        const waveformUrl = srcRelative
          ? `/api/projects/${pid}/waveform/${srcRelative}`
          : undefined;
        return (
          <AudioWaveform
            audioUrl={audioUrl}
            waveformUrl={waveformUrl}
            label={getTimelineElementLabel(el)}
            labelColor={style.label}
          />
        );
      }

      if ((el.tag === "video" || el.tag === "img") && el.src) {
        const mediaSrc = el.src.startsWith("http")
          ? el.src
          : `/api/projects/${pid}/preview/${el.src}`;
        return (
          <VideoThumbnail
            videoSrc={mediaSrc}
            label={getTimelineElementLabel(el)}
            labelColor={style.label}
            duration={el.duration}
          />
        );
      }

      if (htmlPreviewEligible) {
        return (
          <CompositionThumbnail
            previewUrl={`/api/projects/${pid}/preview`}
            label={getTimelineElementLabel(el)}
            labelColor={style.label}
            accentColor={style.clip}
            selector={el.selector}
            selectorIndex={el.selectorIndex}
            seekTime={el.start}
            duration={el.duration}
          />
        );
      }

      return null;
    },
    [compIdToSrc, activePreviewUrl, effectiveTimelineDuration],
  );
  const timelineToolbar = (
    <div className="border-b border-neutral-800/40 bg-neutral-950/96">
      {timelineVisible && timelineElements.length > 0 && !timelineEditorHintDismissed && (
        <div className="px-3 pt-3">
          <div className="flex items-start justify-between gap-3 rounded-xl border border-studio-accent/20 bg-studio-accent/[0.07] px-3 py-3">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-neutral-100">Timeline editor</div>
              <p className="mt-1 text-[11px] leading-5 text-neutral-300">
                Drag clips to move timing, and drag clip edges to resize them when handles are
                available. Hide the panel anytime and bring it back with{" "}
                <span className="font-mono text-[10px] text-studio-accent">
                  {TIMELINE_TOGGLE_SHORTCUT_LABEL}
                </span>
                .
              </p>
            </div>
            <button
              type="button"
              onClick={dismissTimelineEditorHint}
              className="flex-shrink-0 rounded-md border border-neutral-700 px-2 py-1 text-[10px] font-medium text-neutral-300 transition-colors hover:border-neutral-500 hover:text-neutral-100"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between px-3 py-2">
        <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-neutral-500">
          Timeline
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setZoomMode("fit")}
            className={`h-7 px-2.5 rounded-md border text-[11px] font-medium transition-colors ${
              zoomMode === "fit"
                ? "border-studio-accent/30 bg-studio-accent/10 text-studio-accent"
                : "border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
            }`}
            title="Fit timeline to width"
          >
            Fit
          </button>
          <button
            type="button"
            onClick={() => {
              setZoomMode("manual");
              setManualZoomPercent(getNextTimelineZoomPercent("out", zoomMode, manualZoomPercent));
            }}
            className="h-7 w-7 rounded-md border border-neutral-800 text-neutral-400 transition-colors hover:border-neutral-700 hover:text-neutral-200"
            title="Zoom out"
          >
            -
          </button>
          <div className="min-w-[58px] text-center text-[10px] font-medium tabular-nums text-neutral-500">
            {`${displayedTimelineZoomPercent}%`}
          </div>
          <button
            type="button"
            onClick={() => {
              setZoomMode("manual");
              setManualZoomPercent(getNextTimelineZoomPercent("in", zoomMode, manualZoomPercent));
            }}
            className="h-7 w-7 rounded-md border border-neutral-800 text-neutral-400 transition-colors hover:border-neutral-700 hover:text-neutral-200"
            title="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={toggleTimelineVisibility}
            className="ml-1 flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-neutral-200"
            title={getTimelineToggleTitle(true)}
            aria-label="Hide timeline editor"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 7h14" />
              <path d="m8 11 4 4 4-4" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
  const [lintModal, setLintModal] = useState<LintFinding[] | null>(null);
  const [consoleErrors, setConsoleErrors] = useState<LintFinding[] | null>(null);
  const [linting, setLinting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectIdRef = useRef(projectId);
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const consoleErrorsRef = useRef<LintFinding[]>([]);
  const copiedAgentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const domEditSelectionRef = useRef<DomEditSelection | null>(domEditSelection);
  const domEditGroupSelectionsRef = useRef<DomEditSelection[]>(domEditGroupSelections);
  const domEditHoverSelectionRef = useRef<DomEditSelection | null>(domEditHoverSelection);
  const domEditSaveTimestampRef = useRef(0);
  const domTextCommitVersionRef = useRef(0);
  const domEditSaveQueueRef = useRef(Promise.resolve());
  const studioManualEditManifestRef = useRef<StudioManualEditManifest>(
    emptyStudioManualEditManifest(),
  );
  const studioManualEditRevisionRef = useRef(0);
  const applyStudioManualEditsToPreviewRef = useRef<
    (
      iframe?: HTMLIFrameElement | null,
      options?: { forceFromDisk?: boolean; readFromDiskFirst?: boolean },
    ) => Promise<void>
  >(async () => {});
  const studioManualEditProjectRef = useRef<string | null>(projectId);
  const activeCompPathRef = useRef(activeCompPath);
  activeCompPathRef.current = activeCompPath;

  const queueDomEditSave = useCallback((save: () => Promise<void>) => {
    const queuedSave = domEditSaveQueueRef.current.catch(() => undefined).then(save);
    domEditSaveQueueRef.current = queuedSave.then(
      () => undefined,
      () => undefined,
    );
    return queuedSave;
  }, []);

  const waitForPendingDomEditSaves = useCallback(async () => {
    await domEditSaveQueueRef.current.catch(() => undefined);
  }, []);

  // Listen for external file changes (user editing HTML outside the editor).
  // In dev: use Vite HMR. In embedded/production: use SSE from /api/events.
  // Suppress file-change events that echo back from a recent DOM edit save —
  // those changes are already applied to the iframe DOM and a full reload
  // would flash the preview.
  useMountEffect(() => {
    const handler = (payload?: unknown) => {
      const changedPath = readStudioFileChangePath(payload);
      const recentDomEditSave = Date.now() - domEditSaveTimestampRef.current < 1200;
      if (isStudioManualEditManifestPath(changedPath)) {
        if (!recentDomEditSave) {
          void applyStudioManualEditsToPreviewRef.current(previewIframeRef.current, {
            forceFromDisk: true,
          });
        }
        return;
      }
      if (recentDomEditSave) return;
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => setRefreshKey((k) => k + 1), 400);
    };
    if (import.meta.hot) {
      import.meta.hot.on("hf:file-change", handler);
      return () => import.meta.hot?.off?.("hf:file-change", handler);
    }
    // SSE fallback for embedded studio server
    const es = new EventSource("/api/events");
    es.addEventListener("file-change", handler);
    return () => es.close();
  });
  projectIdRef.current = projectId;
  domEditSelectionRef.current = domEditSelection;
  domEditGroupSelectionsRef.current = domEditGroupSelections;
  domEditHoverSelectionRef.current = domEditHoverSelection;

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    const previousProjectId = studioManualEditProjectRef.current;
    studioManualEditProjectRef.current = projectId;
    if (!previousProjectId || previousProjectId === projectId) return;
    studioManualEditManifestRef.current = emptyStudioManualEditManifest();
    studioManualEditRevisionRef.current += 1;
  }, [projectId]);

  // Load file tree when projectId changes.
  // Note: This is one of the few places where useEffect with deps is acceptable —
  // it's data fetching tied to a prop change. Ideally this would use a data-fetching
  // library (useQuery/useSWR) or the parent component would own the fetch.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}`)
      .then((r) => r.json())
      .then((data: { files?: string[]; dir?: string }) => {
        if (!cancelled && data.files) setFileTree(data.files);
        if (!cancelled) setProjectDir(typeof data.dir === "string" ? data.dir : null);
      })
      .catch(() => {
        if (!cancelled) setProjectDir(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const handleFileSelect = useCallback((path: string) => {
    const pid = projectIdRef.current;
    if (!pid) return;
    // Expand left panel to 50vw when opening a file in Code tab
    setLeftWidth((prev) => Math.max(prev, Math.floor(window.innerWidth * 0.5)));
    // Skip fetching binary content for media files — just set the path for preview
    if (isMediaFile(path)) {
      setEditingFile({ path, content: null });
      return;
    }
    fetch(`/api/projects/${pid}/files/${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((data: { content?: string }) => {
        if (data.content != null) {
          setEditingFile({ path, content: data.content });
        }
      })
      .catch(() => {});
  }, []);

  const editingPathRef = useRef(editingFile?.path);
  editingPathRef.current = editingFile?.path;
  const editHistory = usePersistentEditHistory({ projectId });

  const readProjectFile = useCallback(async (path: string): Promise<string> => {
    const pid = projectIdRef.current;
    if (!pid) throw new Error("No active project");
    const response = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(path)}`);
    if (!response.ok) throw new Error(`Failed to read ${path}`);
    const data = (await response.json()) as { content?: string };
    if (typeof data.content !== "string") throw new Error(`Missing file contents for ${path}`);
    return data.content;
  }, []);

  const writeProjectFile = useCallback(async (path: string, content: string): Promise<void> => {
    const pid = projectIdRef.current;
    if (!pid) throw new Error("No active project");
    const response = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(path)}`, {
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body: content,
    });
    if (!response.ok) throw new Error(`Failed to save ${path}`);
    if (editingPathRef.current === path) {
      setEditingFile({ path, content });
    }
  }, []);

  const readOptionalProjectFile = useCallback(async (path: string): Promise<string> => {
    const pid = projectIdRef.current;
    if (!pid) throw new Error("No active project");
    const response = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(path)}`);
    if (response.status === 404) return "";
    if (!response.ok) throw new Error(`Failed to read ${path}`);
    const data = (await response.json()) as { content?: string };
    return typeof data.content === "string" ? data.content : "";
  }, []);

  const handleContentChange = useCallback(
    (content: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const path = editingPathRef.current;
      if (!path) return;

      // Debounce the server write (600ms)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveProjectFilesWithHistory({
          projectId: pid,
          label: "Edit source",
          kind: "source",
          coalesceKey: `source:${path}`,
          files: { [path]: content },
          readFile: readProjectFile,
          writeFile: writeProjectFile,
          recordEdit: editHistory.recordEdit,
        })
          .then(() => {
            if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
            refreshTimerRef.current = setTimeout(() => setRefreshKey((k) => k + 1), 600);
          })
          .catch(() => {});
      }, 600);
    },
    [editHistory.recordEdit, readProjectFile, writeProjectFile],
  );

  const handleTimelineElementMove = useCallback(
    async (element: TimelineElement, updates: Pick<TimelineElement, "start" | "track">) => {
      const pid = projectIdRef.current;
      if (!pid) throw new Error("No active project");

      const targetPath = element.sourceFile || activeCompPath || "index.html";
      const response = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(targetPath)}`);
      if (!response.ok) {
        throw new Error(`Failed to read ${targetPath}`);
      }

      const data = (await response.json()) as { content?: string };
      const originalContent = data.content;
      if (typeof originalContent !== "string") {
        throw new Error(`Missing file contents for ${targetPath}`);
      }

      const patchTarget = element.domId
        ? { id: element.domId, selector: element.selector, selectorIndex: element.selectorIndex }
        : element.selector
          ? { selector: element.selector, selectorIndex: element.selectorIndex }
          : null;
      if (!patchTarget) {
        throw new Error(`Timeline element ${element.id} is missing a patchable target`);
      }

      const resolvedTargetPath = targetPath || "index.html";
      const relevantElements = timelineElements
        .map((timelineElement) =>
          (timelineElement.key ?? timelineElement.id) === (element.key ?? element.id)
            ? { ...timelineElement, start: updates.start, track: updates.track }
            : timelineElement,
        )
        .filter(
          (timelineElement) =>
            (timelineElement.sourceFile || activeCompPath || "index.html") === resolvedTargetPath,
        );
      const trackZIndices = buildTrackZIndexMap(
        relevantElements.map((timelineElement) => timelineElement.track),
      );

      let patchedContent = applyPatchByTarget(originalContent, patchTarget, {
        type: "attribute",
        property: "start",
        value: formatTimelineAttributeNumber(updates.start),
      });
      patchedContent = applyPatchByTarget(patchedContent, patchTarget, {
        type: "attribute",
        property: "track-index",
        value: String(updates.track),
      });
      for (const timelineElement of relevantElements) {
        const elementTarget = timelineElement.domId
          ? {
              id: timelineElement.domId,
              selector: timelineElement.selector,
              selectorIndex: timelineElement.selectorIndex,
            }
          : timelineElement.selector
            ? {
                selector: timelineElement.selector,
                selectorIndex: timelineElement.selectorIndex,
              }
            : null;
        if (!elementTarget) continue;
        const nextZIndex = trackZIndices.get(timelineElement.track);
        if (nextZIndex == null) continue;
        patchedContent = applyPatchByTarget(patchedContent, elementTarget, {
          type: "inline-style",
          property: "z-index",
          value: String(nextZIndex),
        });
      }

      if (patchedContent === originalContent) {
        throw new Error(`Unable to patch timeline element ${element.id} in ${targetPath}`);
      }

      await saveProjectFilesWithHistory({
        projectId: pid,
        label: "Move timeline clip",
        kind: "timeline",
        files: { [targetPath]: patchedContent },
        readFile: async () => originalContent,
        writeFile: writeProjectFile,
        recordEdit: editHistory.recordEdit,
      });

      setRefreshKey((k) => k + 1);
    },
    [activeCompPath, editHistory.recordEdit, timelineElements, writeProjectFile],
  );

  const handleTimelineElementResize = useCallback(
    async (
      element: TimelineElement,
      updates: Pick<TimelineElement, "start" | "duration" | "playbackStart">,
    ) => {
      const pid = projectIdRef.current;
      if (!pid) throw new Error("No active project");

      const targetPath = element.sourceFile || activeCompPath || "index.html";
      const response = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(targetPath)}`);
      if (!response.ok) {
        throw new Error(`Failed to read ${targetPath}`);
      }

      const data = (await response.json()) as { content?: string };
      const originalContent = data.content;
      if (typeof originalContent !== "string") {
        throw new Error(`Missing file contents for ${targetPath}`);
      }

      const patchTarget = element.domId
        ? { id: element.domId, selector: element.selector, selectorIndex: element.selectorIndex }
        : element.selector
          ? { selector: element.selector, selectorIndex: element.selectorIndex }
          : null;
      if (!patchTarget) {
        throw new Error(`Timeline element ${element.id} is missing a patchable target`);
      }

      const playbackStartAttrName =
        element.playbackStartAttr === "playback-start" ? "playback-start" : "media-start";
      const currentPlaybackStartValue =
        readAttributeByTarget(originalContent, patchTarget, "playback-start") ??
        readAttributeByTarget(originalContent, patchTarget, "media-start");
      const currentPlaybackStart =
        currentPlaybackStartValue != null ? parseFloat(currentPlaybackStartValue) : undefined;
      const trimDelta = updates.start - element.start;
      const fallbackPlaybackStart =
        updates.playbackStart == null &&
        trimDelta !== 0 &&
        Number.isFinite(currentPlaybackStart) &&
        currentPlaybackStart != null
          ? Math.max(0, currentPlaybackStart + trimDelta * Math.max(element.playbackRate ?? 1, 0.1))
          : undefined;
      const nextPlaybackStart = updates.playbackStart ?? fallbackPlaybackStart;

      let patchedContent = originalContent;
      patchedContent = applyPatchByTarget(patchedContent, patchTarget, {
        type: "attribute",
        property: "start",
        value: formatTimelineAttributeNumber(updates.start),
      });
      patchedContent = applyPatchByTarget(patchedContent, patchTarget, {
        type: "attribute",
        property: "duration",
        value: formatTimelineAttributeNumber(updates.duration),
      });
      if (nextPlaybackStart != null) {
        patchedContent = applyPatchByTarget(patchedContent, patchTarget, {
          type: "attribute",
          property: playbackStartAttrName,
          value: formatTimelineAttributeNumber(nextPlaybackStart),
        });
      }

      if (patchedContent === originalContent) {
        throw new Error(`Unable to patch timeline element ${element.id} in ${targetPath}`);
      }

      await saveProjectFilesWithHistory({
        projectId: pid,
        label: "Resize timeline clip",
        kind: "timeline",
        files: { [targetPath]: patchedContent },
        readFile: async () => originalContent,
        writeFile: writeProjectFile,
        recordEdit: editHistory.recordEdit,
      });

      setRefreshKey((k) => k + 1);
    },
    [activeCompPath, editHistory.recordEdit, writeProjectFile],
  );

  const showToast = useCallback((message: string, tone: AppToast["tone"] = "error") => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setAppToast({ message, tone });
    toastTimerRef.current = setTimeout(() => setAppToast(null), 4000);
  }, []);

  const handleCaptureFrameClick = useCallback(
    async (event: MouseEvent<HTMLAnchorElement>) => {
      if (!projectId) return;
      event.preventDefault();

      const currentTime = usePlayerStore.getState().currentTime;
      setCaptureFrameTime(currentTime);
      await waitForPendingDomEditSaves();
      const href = buildFrameCaptureUrl({
        projectId,
        compositionPath: activeCompPath,
        currentTime,
      });
      const filename = buildFrameCaptureFilename(activeCompPath, currentTime);

      try {
        const response = await fetch(href, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Capture failed (${response.status})`);
        }
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Capture failed";
        showToast(message);
      }
    },
    [activeCompPath, projectId, showToast, waitForPendingDomEditSaves],
  );

  const handleTimelineElementDelete = useCallback(
    async (element: TimelineElement) => {
      const pid = projectIdRef.current;
      if (!pid) throw new Error("No active project");

      const targetPath = element.sourceFile || activeCompPath || "index.html";
      try {
        const response = await fetch(
          `/api/projects/${pid}/files/${encodeURIComponent(targetPath)}`,
        );
        if (!response.ok) {
          throw new Error(`Failed to read ${targetPath}`);
        }

        const data = (await response.json()) as { content?: string };
        const originalContent = data.content;
        if (typeof originalContent !== "string") {
          throw new Error(`Missing file contents for ${targetPath}`);
        }

        const patchTarget = element.domId
          ? { id: element.domId, selector: element.selector, selectorIndex: element.selectorIndex }
          : element.selector
            ? { selector: element.selector, selectorIndex: element.selectorIndex }
            : null;
        if (!patchTarget) {
          throw new Error(`Timeline element ${element.id} is missing a patchable target`);
        }

        const resolvedTargetPath = targetPath || "index.html";
        const remainingElements = timelineElements.filter(
          (timelineElement) =>
            (timelineElement.key ?? timelineElement.id) !== (element.key ?? element.id) &&
            (timelineElement.sourceFile || activeCompPath || "index.html") === resolvedTargetPath,
        );
        const trackZIndices = buildTrackZIndexMap(
          remainingElements.map((timelineElement) => timelineElement.track),
        );

        const removeResponse = await fetch(
          `/api/projects/${pid}/file-mutations/remove-element/${encodeURIComponent(targetPath)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target: patchTarget }),
          },
        );
        if (!removeResponse.ok) {
          throw new Error(`Failed to delete ${element.id} from ${targetPath}`);
        }

        const removeData = (await removeResponse.json()) as {
          changed?: boolean;
          content?: string;
        };
        let patchedContent =
          typeof removeData.content === "string" ? removeData.content : originalContent;
        for (const timelineElement of remainingElements) {
          const elementTarget = timelineElement.domId
            ? {
                id: timelineElement.domId,
                selector: timelineElement.selector,
                selectorIndex: timelineElement.selectorIndex,
              }
            : timelineElement.selector
              ? {
                  selector: timelineElement.selector,
                  selectorIndex: timelineElement.selectorIndex,
                }
              : null;
          if (!elementTarget) continue;
          const nextZIndex = trackZIndices.get(timelineElement.track);
          if (nextZIndex == null) continue;
          patchedContent = applyPatchByTarget(patchedContent, elementTarget, {
            type: "inline-style",
            property: "z-index",
            value: String(nextZIndex),
          });
        }

        await saveProjectFilesWithHistory({
          projectId: pid,
          label: "Delete timeline clip",
          kind: "timeline",
          files: { [targetPath]: patchedContent },
          readFile: async () => originalContent,
          writeFile: writeProjectFile,
          recordEdit: editHistory.recordEdit,
        });

        usePlayerStore
          .getState()
          .setElements(
            timelineElements.filter(
              (timelineElement) =>
                (timelineElement.key ?? timelineElement.id) !== (element.key ?? element.id),
            ),
          );
        usePlayerStore.getState().setSelectedElementId(null);
        setRefreshKey((k) => k + 1);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to delete timeline clip";
        showToast(message);
      }
    },
    [activeCompPath, editHistory.recordEdit, showToast, timelineElements, writeProjectFile],
  );

  const handleBlockedTimelineEdit = useCallback(
    (_element: TimelineElement) => {
      const now = Date.now();
      if (now - lastBlockedTimelineToastAtRef.current < 1500) return;
      lastBlockedTimelineToastAtRef.current = now;
      showToast("This clip can’t be moved or resized from the timeline yet.", "info");
    },
    [showToast],
  );

  const handleBlockedDomMove = useCallback(
    (selection: DomEditSelection) => {
      const now = Date.now();
      if (now - lastBlockedDomMoveToastAtRef.current < 1500) return;
      lastBlockedDomMoveToastAtRef.current = now;
      showToast(
        selection.capabilities.reasonIfDisabled ??
          "This element can’t be adjusted directly from the preview.",
        "info",
      );
    },
    [showToast],
  );

  const applyDomSelection = useCallback(
    (
      selection: DomEditSelection | null,
      options?: { revealPanel?: boolean; additive?: boolean; preserveGroup?: boolean },
    ) => {
      setAgentPromptTagSnippet(undefined);
      setCopiedAgentPrompt(false);
      if (!selection) {
        domEditSelectionRef.current = null;
        domEditGroupSelectionsRef.current = [];
        setDomEditSelection(null);
        setDomEditGroupSelections([]);
        setSelectedTimelineElementId(null);
        return;
      }

      const isAdditiveSelection = Boolean(options?.additive);
      const currentSelection = domEditSelectionRef.current;
      const previousGroup = domEditGroupSelectionsRef.current;
      const currentGroup = isAdditiveSelection
        ? seedDomEditGroupWithSelection(previousGroup, currentSelection)
        : previousGroup;
      const wasInGroup = domEditSelectionInGroup(currentGroup, selection);
      const nextGroup = options?.preserveGroup
        ? replaceDomEditGroupSelection(currentGroup, selection)
        : isAdditiveSelection
          ? toggleDomEditGroupSelection(currentGroup, selection)
          : [selection];
      const nextSelection = options?.preserveGroup
        ? selection
        : isAdditiveSelection && wasInGroup
          ? domEditSelectionsTargetSame(currentSelection, selection)
            ? (nextGroup[0] ?? null)
            : domEditSelectionInGroup(nextGroup, currentSelection)
              ? currentSelection
              : (nextGroup[0] ?? null)
          : selection;

      domEditSelectionRef.current = nextSelection;
      domEditGroupSelectionsRef.current = nextGroup;
      setDomEditSelection(nextSelection);
      setDomEditGroupSelections(nextGroup);

      if (nextSelection) {
        if (options?.revealPanel !== false) {
          setRightCollapsed(false);
          setRightPanelTab("design");
        }
        const nextSelectedTimelineId = findMatchingTimelineElementId(
          nextSelection,
          timelineElements,
        );
        setSelectedTimelineElementId(nextSelectedTimelineId);
        return;
      }

      setSelectedTimelineElementId(null);
    },
    [setSelectedTimelineElementId, timelineElements],
  );

  const clearDomSelection = useCallback(() => {
    applyDomSelection(null, { revealPanel: false });
  }, [applyDomSelection]);

  const readHistoryProjectFile = useCallback(
    async (path: string): Promise<string> => {
      return path === STUDIO_MANUAL_EDITS_PATH
        ? readOptionalProjectFile(path)
        : readProjectFile(path);
    },
    [readOptionalProjectFile, readProjectFile],
  );

  const writeHistoryProjectFile = useCallback(
    async (path: string, content: string): Promise<void> => {
      await writeProjectFile(path, content);
      if (path === STUDIO_MANUAL_EDITS_PATH) {
        domEditSaveTimestampRef.current = Date.now();
      }
    },
    [writeProjectFile],
  );

  const applyCurrentStudioManualEditsToPreview = useCallback(
    (iframe: HTMLIFrameElement | null = previewIframeRef.current) => {
      if (!iframe) return;
      let doc: Document | null = null;
      try {
        doc = iframe.contentDocument;
      } catch {
        return;
      }
      if (!doc) return;
      const previewDoc = doc;

      const applyManifest = () => {
        applyStudioManualEditManifest(
          previewDoc,
          studioManualEditManifestRef.current,
          activeCompPathRef.current,
        );
      };
      const applyAndInstallSeekHooks = () => {
        applyManifest();
        if (iframe.contentWindow) {
          installStudioManualEditSeekReapply(iframe.contentWindow, applyManifest);
        }
      };

      const win = iframe.contentWindow;
      applyAndInstallSeekHooks();
      win?.requestAnimationFrame?.(applyAndInstallSeekHooks);
      win?.setTimeout?.(applyAndInstallSeekHooks, 80);
      win?.setTimeout?.(applyAndInstallSeekHooks, 250);
      win?.setTimeout?.(applyAndInstallSeekHooks, 500);
      win?.setTimeout?.(applyAndInstallSeekHooks, 1000);
      win?.setTimeout?.(applyAndInstallSeekHooks, 2000);
    },
    [],
  );

  const applyStudioManualEditsToPreview = useCallback(
    async (
      iframe: HTMLIFrameElement | null = previewIframeRef.current,
      options?: { forceFromDisk?: boolean; readFromDiskFirst?: boolean },
    ) => {
      const readRevision = studioManualEditRevisionRef.current;
      const readFromDiskFirst = Boolean(options?.forceFromDisk || options?.readFromDiskFirst);
      if (!readFromDiskFirst) {
        applyCurrentStudioManualEditsToPreview(iframe);
      }
      let content: string;
      try {
        content = await readOptionalProjectFile(STUDIO_MANUAL_EDITS_PATH);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to read manual edit manifest";
        showToast(message);
        if (readFromDiskFirst) {
          applyCurrentStudioManualEditsToPreview(iframe);
        }
        return;
      }
      if (options?.forceFromDisk || readRevision === studioManualEditRevisionRef.current) {
        studioManualEditManifestRef.current = parseStudioManualEditManifest(content);
        if (options?.forceFromDisk) studioManualEditRevisionRef.current += 1;
        applyCurrentStudioManualEditsToPreview(iframe);
        return;
      }
      if (readFromDiskFirst) {
        applyCurrentStudioManualEditsToPreview(iframe);
      }
    },
    [applyCurrentStudioManualEditsToPreview, readOptionalProjectFile, showToast],
  );
  applyStudioManualEditsToPreviewRef.current = applyStudioManualEditsToPreview;

  const applyStudioManualEditsToPreviewAfterRefresh = useCallback(
    (iframe: HTMLIFrameElement | null = previewIframeRef.current) =>
      applyStudioManualEditsToPreview(iframe, { readFromDiskFirst: true }),
    [applyStudioManualEditsToPreview],
  );

  const commitStudioManualEditManifestOptimistically = useCallback(
    (
      updateManifest: (manifest: StudioManualEditManifest) => StudioManualEditManifest,
      options: { label: string; coalesceKey: string },
    ) => {
      const previousManifest = studioManualEditManifestRef.current;
      const nextManifest = updateManifest(previousManifest);
      const previousContent = serializeStudioManualEditManifest(previousManifest);
      const nextContent = serializeStudioManualEditManifest(nextManifest);
      if (nextContent === previousContent) {
        return;
      }

      const revision = studioManualEditRevisionRef.current + 1;
      studioManualEditRevisionRef.current = revision;
      studioManualEditManifestRef.current = nextManifest;
      applyCurrentStudioManualEditsToPreview(previewIframeRef.current);

      const save = async () => {
        const originalContent = await readOptionalProjectFile(STUDIO_MANUAL_EDITS_PATH);
        const diskManifest = parseStudioManualEditManifest(originalContent);
        const nextDiskManifest = updateManifest(diskManifest);
        const nextDiskContent = serializeStudioManualEditManifest(nextDiskManifest);
        if (nextDiskContent === originalContent) {
          return;
        }

        const pid = projectIdRef.current;
        if (!pid) throw new Error("No active project");
        domEditSaveTimestampRef.current = Date.now();
        await saveProjectFilesWithHistory({
          projectId: pid,
          label: options.label,
          kind: "manual",
          coalesceKey: options.coalesceKey,
          files: { [STUDIO_MANUAL_EDITS_PATH]: nextDiskContent },
          readFile: async () => originalContent,
          writeFile: writeProjectFile,
          recordEdit: editHistory.recordEdit,
        });
        domEditSaveTimestampRef.current = Date.now();

        if (studioManualEditRevisionRef.current === revision) {
          studioManualEditManifestRef.current = nextDiskManifest;
          applyCurrentStudioManualEditsToPreview(previewIframeRef.current);
        }
      };

      void queueDomEditSave(save).catch((error) => {
        if (studioManualEditRevisionRef.current === revision) {
          studioManualEditRevisionRef.current += 1;
          studioManualEditManifestRef.current = previousManifest;
          applyCurrentStudioManualEditsToPreview(previewIframeRef.current);
        }
        const message = error instanceof Error ? error.message : "Failed to save manual edit";
        showToast(message);
      });
    },
    [
      applyCurrentStudioManualEditsToPreview,
      editHistory.recordEdit,
      queueDomEditSave,
      readOptionalProjectFile,
      showToast,
      writeProjectFile,
    ],
  );

  const syncHistoryPreviewAfterApply = useCallback(
    async (paths: string[] | undefined) => {
      const changedPaths = paths ?? [];
      const manualManifestOnly =
        changedPaths.length > 0 && changedPaths.every((path) => path === STUDIO_MANUAL_EDITS_PATH);

      if (manualManifestOnly) {
        await applyStudioManualEditsToPreview(previewIframeRef.current, { forceFromDisk: true });
        return;
      }

      setRefreshKey((key) => key + 1);
    },
    [applyStudioManualEditsToPreview],
  );

  const handleUndo = useCallback(async () => {
    await waitForPendingDomEditSaves();
    const result = await editHistory.undo({
      readFile: readHistoryProjectFile,
      writeFile: writeHistoryProjectFile,
    });
    if (!result.ok && result.reason === "content-mismatch") {
      showToast("File changed outside Studio. Undo history was not applied.", "info");
      return;
    }
    if (result.ok && result.label) {
      clearDomSelection();
      await syncHistoryPreviewAfterApply(result.paths);
      showToast(`Undid ${result.label}`, "info");
    }
  }, [
    clearDomSelection,
    editHistory,
    readHistoryProjectFile,
    showToast,
    syncHistoryPreviewAfterApply,
    waitForPendingDomEditSaves,
    writeHistoryProjectFile,
  ]);

  const handleRedo = useCallback(async () => {
    await waitForPendingDomEditSaves();
    const result = await editHistory.redo({
      readFile: readHistoryProjectFile,
      writeFile: writeHistoryProjectFile,
    });
    if (!result.ok && result.reason === "content-mismatch") {
      showToast("File changed outside Studio. Redo history was not applied.", "info");
      return;
    }
    if (result.ok && result.label) {
      clearDomSelection();
      await syncHistoryPreviewAfterApply(result.paths);
      showToast(`Redid ${result.label}`, "info");
    }
  }, [
    clearDomSelection,
    editHistory,
    readHistoryProjectFile,
    showToast,
    syncHistoryPreviewAfterApply,
    waitForPendingDomEditSaves,
    writeHistoryProjectFile,
  ]);

  const handleUndoRef = useRef(handleUndo);
  const handleRedoRef = useRef(handleRedo);
  handleUndoRef.current = handleUndo;
  handleRedoRef.current = handleRedo;

  const handleHistoryHotkey = useCallback((event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    if (shouldIgnoreHistoryShortcut(event.target)) return;
    const key = event.key.toLowerCase();
    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      void handleUndoRef.current();
      return;
    }
    if ((key === "z" && event.shiftKey) || (event.ctrlKey && !event.metaKey && key === "y")) {
      event.preventDefault();
      void handleRedoRef.current();
    }
  }, []);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    window.addEventListener("keydown", handleHistoryHotkey, true);
    return () => window.removeEventListener("keydown", handleHistoryHotkey, true);
  }, [handleHistoryHotkey]);

  const syncPreviewHistoryHotkey = useCallback(
    (iframe: HTMLIFrameElement | null) => {
      previewHistoryHotkeyCleanupRef.current?.();
      previewHistoryHotkeyCleanupRef.current = null;

      const win = iframe?.contentWindow ?? null;
      let doc: Document | null = null;
      try {
        doc = iframe?.contentDocument ?? null;
      } catch {
        doc = null;
      }
      if (!win && !doc) return;

      win?.addEventListener("keydown", handleHistoryHotkey, true);
      doc?.addEventListener("keydown", handleHistoryHotkey, true);
      previewHistoryHotkeyCleanupRef.current = () => {
        win?.removeEventListener("keydown", handleHistoryHotkey, true);
        doc?.removeEventListener("keydown", handleHistoryHotkey, true);
      };
    },
    [handleHistoryHotkey],
  );

  useEffect(
    () => () => {
      previewHistoryHotkeyCleanupRef.current?.();
      previewHistoryHotkeyCleanupRef.current = null;
    },
    [],
  );

  const buildDomSelectionFromTarget = useCallback(
    (target: HTMLElement, options?: { preferClipAncestor?: boolean }) => {
      return resolveDomEditSelection(target, {
        activeCompositionPath: activeCompPath,
        isMasterView,
        preferClipAncestor: options?.preferClipAncestor,
      });
    },
    [activeCompPath, isMasterView],
  );

  const resolveDomSelectionFromPreviewPoint = useCallback(
    (clientX: number, clientY: number, options?: { preferClipAncestor?: boolean }) => {
      const iframe = previewIframeRef.current;
      if (!iframe || captionEditMode) return null;
      const target = getPreviewTargetFromPointer(iframe, clientX, clientY);
      if (!target) return null;
      return buildDomSelectionFromTarget(target, {
        preferClipAncestor: options?.preferClipAncestor,
      });
    },
    [buildDomSelectionFromTarget, captionEditMode],
  );

  const updateDomEditHoverSelection = useCallback((selection: DomEditSelection | null) => {
    if (domEditSelectionsTargetSame(domEditHoverSelectionRef.current, selection)) return;
    domEditHoverSelectionRef.current = selection;
    setDomEditHoverSelection(selection);
  }, []);

  const preloadAgentPromptSnippet = useCallback(
    async (selection: DomEditSelection) => {
      const pid = projectIdRef.current;
      if (!pid) return;

      const targetPath = selection.sourceFile || activeCompPath || "index.html";
      try {
        const response = await fetch(
          `/api/projects/${pid}/files/${encodeURIComponent(targetPath)}`,
        );
        if (!response.ok) return;

        const data = (await response.json()) as { content?: string };
        const html = data.content;
        const tagSnippet =
          typeof html === "string" ? readTagSnippetByTarget(html, selection) : undefined;

        setAgentPromptTagSnippet((current) => {
          if (domEditSelectionRef.current !== selection) return current;
          return tagSnippet;
        });
      } catch {
        // Runtime outerHTML is still available as a synchronous copy fallback.
      }
    },
    [activeCompPath],
  );

  const resolveImportedFontAsset = useCallback(
    (fontFamilyValue: string): ImportedFontAsset | null => {
      const family = primaryFontFamilyValue(fontFamilyValue);
      if (!family) return null;
      const imported = importedFontAssetsRef.current.find(
        (font) => font.family.toLowerCase() === family.toLowerCase(),
      );
      if (imported) return imported;
      const asset = fileTree.find(
        (path) =>
          FONT_EXT.test(path) &&
          fontFamilyFromAssetPath(path).toLowerCase() === family.toLowerCase(),
      );
      if (!asset) return null;
      return {
        family: fontFamilyFromAssetPath(asset),
        path: asset,
        url: `/api/projects/${projectId}/preview/${asset}`,
      };
    },
    [fileTree, projectId],
  );

  const persistDomEditOperations = useCallback(
    async (
      selection: DomEditSelection,
      operations: Parameters<typeof applyPatchByTarget>[2][],
      options?: {
        label?: string;
        coalesceKey?: string;
        skipRefresh?: boolean;
        prepareContent?: (html: string, sourceFile: string) => string;
        shouldSave?: () => boolean;
      },
    ) => {
      const pid = projectIdRef.current;
      if (!pid) throw new Error("No active project");
      if (options?.shouldSave && !options.shouldSave()) return;

      const targetPath = selection.sourceFile || activeCompPath || "index.html";
      const response = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(targetPath)}`);
      if (!response.ok) {
        throw new Error(`Failed to read ${targetPath}`);
      }

      const data = (await response.json()) as { content?: string };
      const originalContent = data.content;
      if (typeof originalContent !== "string") {
        throw new Error(`Missing file contents for ${targetPath}`);
      }

      let patchedContent = originalContent;
      for (const operation of operations) {
        patchedContent = applyPatchByTarget(patchedContent, selection, operation);
      }
      if (options?.prepareContent) {
        patchedContent = options.prepareContent(patchedContent, targetPath);
      }
      if (options?.shouldSave && !options.shouldSave()) return;

      if (patchedContent === originalContent) {
        throw new Error(`Unable to patch ${selection.selector ?? selection.id ?? "selection"}`);
      }

      await saveProjectFilesWithHistory({
        projectId: pid,
        label: options?.label ?? "Edit layer",
        kind: "manual",
        coalesceKey: options?.coalesceKey,
        files: { [targetPath]: patchedContent },
        readFile: async () => originalContent,
        writeFile: writeProjectFile,
        recordEdit: editHistory.recordEdit,
      });

      if (options?.skipRefresh) {
        domEditSaveTimestampRef.current = Date.now();
      } else {
        setRefreshKey((k) => k + 1);
      }
    },
    [activeCompPath, editHistory.recordEdit, writeProjectFile],
  );

  const refreshDomEditSelectionFromPreview = useCallback(
    (selection: DomEditSelection) => {
      const iframe = previewIframeRef.current;
      let doc: Document | null = null;
      try {
        doc = iframe?.contentDocument ?? null;
      } catch {
        return;
      }
      if (!doc) return;

      const element = findElementForSelection(doc, selection, activeCompPath);
      if (!element) return;

      const nextSelection = buildDomSelectionFromTarget(element);
      if (nextSelection) {
        applyDomSelection(nextSelection, { revealPanel: false, preserveGroup: true });
      }
    },
    [activeCompPath, applyDomSelection, buildDomSelectionFromTarget],
  );

  const refreshDomEditGroupSelectionsFromPreview = useCallback(
    (selections: DomEditSelection[]) => {
      const iframe = previewIframeRef.current;
      let doc: Document | null = null;
      try {
        doc = iframe?.contentDocument ?? null;
      } catch {
        return;
      }
      if (!doc) return;

      const nextGroup: DomEditSelection[] = [];
      for (const selection of selections) {
        const element = findElementForSelection(doc, selection, activeCompPath);
        if (!element) continue;
        const nextSelection = buildDomSelectionFromTarget(element);
        if (nextSelection) nextGroup.push(nextSelection);
      }
      if (nextGroup.length === 0) return;

      const currentSelection = domEditSelectionRef.current;
      const nextSelection =
        nextGroup.find((selection) => domEditSelectionsTargetSame(selection, currentSelection)) ??
        nextGroup[0] ??
        null;

      setAgentPromptTagSnippet(undefined);
      setCopiedAgentPrompt(false);
      domEditSelectionRef.current = nextSelection;
      domEditGroupSelectionsRef.current = nextGroup;
      setDomEditSelection(nextSelection);
      setDomEditGroupSelections(nextGroup);

      if (nextSelection) {
        setSelectedTimelineElementId(
          findMatchingTimelineElementId(nextSelection, timelineElements),
        );
      } else {
        setSelectedTimelineElementId(null);
      }
    },
    [activeCompPath, buildDomSelectionFromTarget, setSelectedTimelineElementId, timelineElements],
  );

  const handleDomManualDragStart = useCallback(() => {
    const pausedTime = pauseStudioPreviewPlayback(previewIframeRef.current);
    const playerStore = usePlayerStore.getState();
    playerStore.setIsPlaying(false);
    if (pausedTime != null) {
      playerStore.setCurrentTime(pausedTime);
      liveTime.notify(pausedTime);
    }
  }, []);

  const handleDomPathOffsetCommit = useCallback(
    (selection: DomEditSelection, next: { x: number; y: number }) => {
      commitStudioManualEditManifestOptimistically(
        (manifest) => upsertStudioPathOffsetEdit(manifest, selection, next),
        {
          label: "Move layer",
          coalesceKey: `path-offset:${getDomEditTargetKey(selection)}`,
        },
      );
      refreshDomEditSelectionFromPreview(selection);
    },
    [commitStudioManualEditManifestOptimistically, refreshDomEditSelectionFromPreview],
  );

  const handleDomGroupPathOffsetCommit = useCallback(
    (updates: DomEditGroupPathOffsetCommit[]) => {
      if (updates.length === 0) return;
      const coalesceKey = updates
        .map((update) => getDomEditTargetKey(update.selection))
        .sort()
        .join(":");
      commitStudioManualEditManifestOptimistically(
        (manifest) =>
          updates.reduce(
            (nextManifest, update) =>
              upsertStudioPathOffsetEdit(nextManifest, update.selection, update.next),
            manifest,
          ),
        {
          label: `Move ${updates.length} layers`,
          coalesceKey: `group-path-offset:${coalesceKey}`,
        },
      );
      refreshDomEditGroupSelectionsFromPreview(domEditGroupSelectionsRef.current);
    },
    [commitStudioManualEditManifestOptimistically, refreshDomEditGroupSelectionsFromPreview],
  );

  const handleDomBoxSizeCommit = useCallback(
    (selection: DomEditSelection, next: { width: number; height: number }) => {
      commitStudioManualEditManifestOptimistically(
        (manifest) => upsertStudioBoxSizeEdit(manifest, selection, next),
        {
          label: "Resize layer box",
          coalesceKey: `box-size:${getDomEditTargetKey(selection)}`,
        },
      );
      refreshDomEditSelectionFromPreview(selection);
    },
    [commitStudioManualEditManifestOptimistically, refreshDomEditSelectionFromPreview],
  );

  const handleDomRotationCommit = useCallback(
    (selection: DomEditSelection, next: { angle: number }) => {
      commitStudioManualEditManifestOptimistically(
        (manifest) => upsertStudioRotationEdit(manifest, selection, next),
        {
          label: "Rotate layer",
          coalesceKey: `rotation:${getDomEditTargetKey(selection)}`,
        },
      );
      refreshDomEditSelectionFromPreview(selection);
    },
    [commitStudioManualEditManifestOptimistically, refreshDomEditSelectionFromPreview],
  );

  const handleDomManualEditsReset = useCallback(
    (selection: DomEditSelection) => {
      commitStudioManualEditManifestOptimistically(
        (manifest) => removeStudioManualEditsForSelection(manifest, selection),
        {
          label: "Reset layer edits",
          coalesceKey: `manual-reset:${getDomEditTargetKey(selection)}`,
        },
      );
      applyCurrentStudioManualEditsToPreview(previewIframeRef.current);
      refreshDomEditSelectionFromPreview(selection);
    },
    [
      applyCurrentStudioManualEditsToPreview,
      commitStudioManualEditManifestOptimistically,
      refreshDomEditSelectionFromPreview,
    ],
  );

  const handleDomStyleCommit = useCallback(
    async (property: string, value: string) => {
      if (!domEditSelection) return;
      if (isManualGeometryStyleProperty(property)) return;
      if (!domEditSelection.capabilities.canEditStyles) return;
      const importedFont = property === "font-family" ? resolveImportedFontAsset(value) : null;
      const iframe = previewIframeRef.current;
      const doc = iframe?.contentDocument;
      if (doc) {
        const el = findElementForSelection(doc, domEditSelection, activeCompPath);
        if (el) {
          el.style.setProperty(property, normalizeDomEditStyleValue(property, value));
          if (property === "font-family") {
            injectPreviewGoogleFont(doc, value);
            if (importedFont) injectPreviewImportedFont(doc, importedFont);
          }
          if (property === "background-image" && isImageBackgroundValue(value)) {
            el.style.setProperty("background-position", "center");
            el.style.setProperty("background-repeat", "no-repeat");
            el.style.setProperty("background-size", "contain");
          }
        }
      }
      const operations: PatchOperation[] = [
        buildDomEditStylePatchOperation(property, normalizeDomEditStyleValue(property, value)),
      ];
      if (property === "background-image" && isImageBackgroundValue(value)) {
        operations.push(
          buildDomEditStylePatchOperation("background-position", "center"),
          buildDomEditStylePatchOperation("background-repeat", "no-repeat"),
          buildDomEditStylePatchOperation("background-size", "contain"),
        );
      }
      await persistDomEditOperations(domEditSelection, operations, {
        label: "Edit layer style",
        skipRefresh: true,
        prepareContent: importedFont
          ? (html, sourceFile) => ensureImportedFontFace(html, importedFont, sourceFile)
          : undefined,
      });
    },
    [activeCompPath, domEditSelection, persistDomEditOperations, resolveImportedFontAsset],
  );

  const handleDomTextCommit = useCallback(
    async (value: string, fieldKey?: string) => {
      if (!domEditSelection) return;
      if (!isTextEditableSelection(domEditSelection)) return;
      const commitVersion = domTextCommitVersionRef.current + 1;
      domTextCommitVersionRef.current = commitVersion;
      const nextTextFields =
        domEditSelection.textFields.length > 0
          ? domEditSelection.textFields.map((field) =>
              field.key === fieldKey ? { ...field, value } : field,
            )
          : [];
      const nextContent =
        nextTextFields.length > 1 || nextTextFields.some((field) => field.source === "child")
          ? serializeDomEditTextFields(nextTextFields)
          : value;
      const iframe = previewIframeRef.current;
      const doc = iframe?.contentDocument;
      if (doc) {
        const el = findElementForSelection(doc, domEditSelection, activeCompPath);
        if (el) {
          if (
            nextTextFields.length > 1 ||
            nextTextFields.some((field) => field.source === "child")
          ) {
            el.innerHTML = nextContent;
          } else {
            el.textContent = value;
          }
        }
      }
      await persistDomEditOperations(
        domEditSelection,
        [buildDomEditTextPatchOperation(nextContent)],
        {
          label: "Edit text",
          skipRefresh: true,
          shouldSave: () => domTextCommitVersionRef.current === commitVersion,
        },
      );
      if (domTextCommitVersionRef.current !== commitVersion) return;

      if (doc) {
        const refreshed = findElementForSelection(doc, domEditSelection, activeCompPath);
        if (refreshed) {
          const nextSelection = buildDomSelectionFromTarget(refreshed);
          if (nextSelection) {
            applyDomSelection(nextSelection, { revealPanel: false, preserveGroup: true });
          }
        }
      }
    },
    [
      activeCompPath,
      applyDomSelection,
      buildDomSelectionFromTarget,
      domEditSelection,
      persistDomEditOperations,
    ],
  );

  const commitDomTextFields = useCallback(
    async (
      selection: DomEditSelection,
      nextTextFields: DomEditTextField[],
      options?: { importedFont?: ImportedFontAsset | null },
    ) => {
      const nextContent =
        nextTextFields.length > 1 || nextTextFields.some((field) => field.source === "child")
          ? serializeDomEditTextFields(nextTextFields)
          : (nextTextFields[0]?.value ?? "");

      const iframe = previewIframeRef.current;
      const doc = iframe?.contentDocument;
      if (doc) {
        const el = findElementForSelection(doc, selection, activeCompPath);
        if (el) {
          if (
            nextTextFields.length > 1 ||
            nextTextFields.some((field) => field.source === "child")
          ) {
            el.innerHTML = nextContent;
          } else {
            el.textContent = nextContent;
          }
        }
      }

      const importedFont = options?.importedFont ?? null;
      await persistDomEditOperations(selection, [buildDomEditTextPatchOperation(nextContent)], {
        label: "Edit text",
        skipRefresh: true,
        prepareContent: importedFont
          ? (html, sourceFile) => ensureImportedFontFace(html, importedFont, sourceFile)
          : undefined,
      });

      if (doc) {
        const refreshed = findElementForSelection(doc, selection, activeCompPath);
        if (refreshed) {
          const nextSelection = buildDomSelectionFromTarget(refreshed);
          if (nextSelection) {
            applyDomSelection(nextSelection, { revealPanel: false, preserveGroup: true });
          }
        }
      }
    },
    [activeCompPath, applyDomSelection, buildDomSelectionFromTarget, persistDomEditOperations],
  );

  const handleDomTextFieldStyleCommit = useCallback(
    async (fieldKey: string, property: string, value: string) => {
      if (!domEditSelection) return;
      const field = domEditSelection.textFields.find((entry) => entry.key === fieldKey);
      if (!field) return;

      if (field.source === "self") {
        await handleDomStyleCommit(property, value);
        return;
      }

      const normalizedValue = normalizeDomEditStyleValue(property, value);
      const importedFont = property === "font-family" ? resolveImportedFontAsset(value) : null;
      if (property === "font-family") {
        const doc = previewIframeRef.current?.contentDocument;
        if (doc) {
          injectPreviewGoogleFont(doc, normalizedValue);
          if (importedFont) injectPreviewImportedFont(doc, importedFont);
        }
      }
      const nextTextFields = domEditSelection.textFields.map((entry) =>
        entry.key === fieldKey
          ? {
              ...entry,
              inlineStyles: {
                ...entry.inlineStyles,
                [property]: normalizedValue,
              },
              computedStyles: {
                ...entry.computedStyles,
                [property]: normalizedValue,
              },
            }
          : entry,
      );

      await commitDomTextFields(domEditSelection, nextTextFields, { importedFont });
    },
    [commitDomTextFields, domEditSelection, handleDomStyleCommit, resolveImportedFontAsset],
  );

  const handleDomAddTextField = useCallback(
    async (afterFieldKey?: string) => {
      if (!domEditSelection) return null;
      if (!domEditSelection.textFields.some((field) => field.source === "child")) return null;

      const insertionIndex = domEditSelection.textFields.findIndex(
        (field) => field.key === afterFieldKey,
      );
      const baseField =
        domEditSelection.textFields[insertionIndex >= 0 ? insertionIndex : 0] ??
        domEditSelection.textFields[0];
      const nextField = buildDefaultDomEditTextField(baseField);
      const nextTextFields = [...domEditSelection.textFields];
      nextTextFields.splice(
        insertionIndex >= 0 ? insertionIndex + 1 : nextTextFields.length,
        0,
        nextField,
      );

      await commitDomTextFields(domEditSelection, nextTextFields);
      return nextField.key;
    },
    [commitDomTextFields, domEditSelection],
  );

  const handleDomRemoveTextField = useCallback(
    async (fieldKey: string) => {
      if (!domEditSelection) return;
      const field = domEditSelection.textFields.find((entry) => entry.key === fieldKey);
      if (!field) return;

      if (field.source === "self") {
        await handleDomTextCommit("", fieldKey);
        return;
      }

      const nextTextFields = domEditSelection.textFields.filter((entry) => entry.key !== fieldKey);
      await commitDomTextFields(domEditSelection, nextTextFields);
    },
    [commitDomTextFields, domEditSelection, handleDomTextCommit],
  );

  const handleAskAgent = useCallback(() => {
    if (!domEditSelection) return;
    setAgentPromptTagSnippet(undefined);
    void preloadAgentPromptSnippet(domEditSelection);
    setAgentModalOpen(true);
  }, [domEditSelection, preloadAgentPromptSnippet]);

  const handleAgentModalSubmit = useCallback(
    async (userInstruction: string) => {
      if (!domEditSelection) return;

      const targetPath = domEditSelection.sourceFile || activeCompPath || "index.html";
      const tagSnippet = agentPromptTagSnippet ?? domEditSelection.element.outerHTML;
      const prompt = buildElementAgentPrompt({
        selection: domEditSelection,
        currentTime,
        tagSnippet,
        userInstruction,
        sourceFilePath: toProjectAbsolutePath(projectDir, targetPath),
      });

      const copied = await copyTextToClipboard(prompt);
      if (!copied) {
        showToast("Could not copy prompt to clipboard.", "error");
        return;
      }

      setAgentModalOpen(false);
      if (copiedAgentTimerRef.current) clearTimeout(copiedAgentTimerRef.current);
      setCopiedAgentPrompt(true);
      copiedAgentTimerRef.current = setTimeout(() => setCopiedAgentPrompt(false), 1600);
    },
    [activeCompPath, agentPromptTagSnippet, currentTime, domEditSelection, projectDir, showToast],
  );

  const handlePreviewIframeRef = useCallback(
    (iframe: HTMLIFrameElement | null) => {
      previewIframeRef.current = iframe;
      setPreviewIframe(iframe);
      syncPreviewTimelineHotkey(iframe);
      syncPreviewHistoryHotkey(iframe);
      consoleErrorsRef.current = [];
      setConsoleErrors(null);
    },
    [syncPreviewHistoryHotkey, syncPreviewTimelineHotkey],
  );

  const handlePreviewCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, options?: { preferClipAncestor?: boolean }) => {
      if (captionEditMode) return;
      const nextSelection = resolveDomSelectionFromPreviewPoint(e.clientX, e.clientY, {
        preferClipAncestor: options?.preferClipAncestor ?? true,
      });
      if (!nextSelection) {
        if (!e.shiftKey) applyDomSelection(null, { revealPanel: false });
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      applyDomSelection(nextSelection, { additive: e.shiftKey });
    },
    [applyDomSelection, captionEditMode, resolveDomSelectionFromPreviewPoint],
  );

  const handlePreviewCanvasPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, options?: { preferClipAncestor?: boolean }) => {
      if (captionEditMode) {
        updateDomEditHoverSelection(null);
        return null;
      }

      const nextSelection = resolveDomSelectionFromPreviewPoint(e.clientX, e.clientY, {
        preferClipAncestor: options?.preferClipAncestor ?? false,
      });
      updateDomEditHoverSelection(nextSelection);
      return nextSelection;
    },
    [captionEditMode, resolveDomSelectionFromPreviewPoint, updateDomEditHoverSelection],
  );

  const handlePreviewCanvasPointerLeave = useCallback(() => {
    updateDomEditHoverSelection(null);
  }, [updateDomEditHoverSelection]);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (captionEditMode) updateDomEditHoverSelection(null);
  }, [captionEditMode, updateDomEditHoverSelection]);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    updateDomEditHoverSelection(null);
  }, [activeCompPath, projectId, previewIframe, refreshKey, updateDomEditHoverSelection]);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!domEditHoverSelection) return;
    const hoverMatchesSelection = domEditSelectionsTargetSame(
      domEditHoverSelection,
      domEditSelection,
    );
    const hoverMatchesGroup = domEditSelectionInGroup(
      domEditGroupSelections,
      domEditHoverSelection,
    );
    if (!hoverMatchesSelection && !hoverMatchesGroup) return;
    updateDomEditHoverSelection(null);
  }, [
    domEditGroupSelections,
    domEditHoverSelection,
    domEditSelection,
    updateDomEditHoverSelection,
  ]);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!domEditHoverSelection) return;
    if (domEditHoverSelection.element.isConnected) return;
    updateDomEditHoverSelection(null);
  }, [domEditHoverSelection, updateDomEditHoverSelection]);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!previewIframe) return;

    const syncSelectionFromDocument = () => {
      if (captionEditMode) return;
      const currentSelection = domEditSelectionRef.current;
      if (!currentSelection) return;
      let doc: Document | null = null;
      try {
        doc = previewIframe.contentDocument;
      } catch {
        return;
      }
      if (!doc) return;

      const nextElement = findElementForSelection(doc, currentSelection, activeCompPath);
      if (!nextElement) {
        applyDomSelection(null, { revealPanel: false });
        return;
      }

      const nextSelection = buildDomSelectionFromTarget(nextElement);
      if (nextSelection) {
        applyDomSelection(nextSelection, { revealPanel: false, preserveGroup: true });
      }
    };

    const attachErrorCapture = () => {
      try {
        const win = previewIframe.contentWindow as (Window & typeof globalThis) | null;
        if (!win) return;
        if ((win as unknown as Record<string, unknown>).__hfErrorCapture) return;
        (win as unknown as Record<string, unknown>).__hfErrorCapture = true;
        const origError = win.console.error.bind(win.console);
        win.console.error = function (...args: unknown[]) {
          origError(...args);
          const text = args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ");
          if (text.includes("favicon")) return;
          consoleErrorsRef.current = [
            ...consoleErrorsRef.current,
            { severity: "error", message: text },
          ];
          setConsoleErrors([...consoleErrorsRef.current]);
        };
        win.addEventListener("error", (e: ErrorEvent) => {
          const text = e.message || String(e);
          consoleErrorsRef.current = [
            ...consoleErrorsRef.current,
            { severity: "error", message: text },
          ];
          setConsoleErrors([...consoleErrorsRef.current]);
        });
      } catch {
        // same-origin only
      }
    };

    attachErrorCapture();
    syncPreviewHistoryHotkey(previewIframe);
    void applyStudioManualEditsToPreviewAfterRefresh(previewIframe);
    syncSelectionFromDocument();

    const handleLoad = () => {
      consoleErrorsRef.current = [];
      setConsoleErrors(null);
      attachErrorCapture();
      syncPreviewHistoryHotkey(previewIframe);
      void applyStudioManualEditsToPreviewAfterRefresh(previewIframe);
      syncSelectionFromDocument();
    };

    previewIframe.addEventListener("load", handleLoad);
    return () => {
      previewIframe.removeEventListener("load", handleLoad);
    };
  }, [
    activeCompPath,
    applyDomSelection,
    applyStudioManualEditsToPreviewAfterRefresh,
    buildDomSelectionFromTarget,
    captionEditMode,
    previewIframe,
    syncPreviewHistoryHotkey,
  ]);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!captionEditMode) return;
    applyDomSelection(null, { revealPanel: false });
  }, [applyDomSelection, captionEditMode]);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(
    () => () => {
      if (copiedAgentTimerRef.current) clearTimeout(copiedAgentTimerRef.current);
    },
    [],
  );

  const refreshFileTree = useCallback(async () => {
    const pid = projectIdRef.current;
    if (!pid) return;
    const res = await fetch(`/api/projects/${pid}`);
    const data = await res.json();
    if (data.files) setFileTree(data.files);
  }, []);

  const uploadProjectFiles = useCallback(
    async (files: Iterable<File>, dir?: string): Promise<string[]> => {
      const pid = projectIdRef.current;
      const fileList = Array.from(files);
      if (!pid || fileList.length === 0) return [];

      const formData = new FormData();
      for (const file of fileList) {
        formData.append("file", file);
      }

      const qs = dir ? `?dir=${encodeURIComponent(dir)}` : "";
      try {
        const res = await fetch(`/api/projects/${pid}/upload${qs}`, {
          method: "POST",
          body: formData,
        });
        if (res.ok) {
          const data = await res.json();
          if (data.skipped?.length) {
            showToast(`Skipped (too large): ${data.skipped.join(", ")}`);
          }
          if (data.invalid?.length) {
            const names = data.invalid.map((entry: { name: string }) => entry.name).join(", ");
            showToast(`Unsupported media skipped: ${names}`);
          }
          await refreshFileTree();
          setRefreshKey((k) => k + 1);
          return Array.isArray(data.files) ? data.files : [];
        } else if (res.status === 413) {
          showToast("Upload rejected: payload too large");
        } else {
          showToast(`Upload failed (${res.status})`);
        }
      } catch {
        showToast("Upload failed: network error");
      }
      return [];
    },
    [refreshFileTree, showToast],
  );

  const handleTimelineAssetDrop = useCallback(
    async (
      assetPath: string,
      placement: Pick<TimelineElement, "start" | "track">,
      durationOverride?: number,
    ) => {
      const pid = projectIdRef.current;
      if (!pid) throw new Error("No active project");

      const kind = getTimelineAssetKind(assetPath);
      if (!kind) {
        showToast("Only image, video, and audio assets can be dropped onto the timeline.");
        return;
      }

      const targetPath = activeCompPath || "index.html";
      try {
        const response = await fetch(
          `/api/projects/${pid}/files/${encodeURIComponent(targetPath)}`,
        );
        if (!response.ok) {
          throw new Error(`Failed to read ${targetPath}`);
        }

        const data = (await response.json()) as { content?: string };
        const originalContent = data.content;
        if (typeof originalContent !== "string") {
          throw new Error(`Missing file contents for ${targetPath}`);
        }

        const normalizedStart = Number(formatTimelineAttributeNumber(placement.start));
        const duration =
          Number.isFinite(durationOverride) && durationOverride != null && durationOverride > 0
            ? durationOverride
            : await resolveDroppedAssetDuration(pid, assetPath, kind);
        const normalizedDuration = Number(formatTimelineAttributeNumber(duration));
        const newId = buildTimelineAssetId(assetPath, collectHtmlIds(originalContent));
        const resolvedAssetSrc = resolveTimelineAssetSrc(targetPath, assetPath);

        const resolvedTargetPath = targetPath || "index.html";
        const relevantElements = timelineElements.filter(
          (timelineElement) =>
            (timelineElement.sourceFile || activeCompPath || "index.html") === resolvedTargetPath,
        );
        const trackZIndices = buildTrackZIndexMap([
          ...relevantElements.map((timelineElement) => timelineElement.track),
          placement.track,
        ]);

        let patchedContent = originalContent;
        for (const timelineElement of relevantElements) {
          const elementTarget = timelineElement.domId
            ? {
                id: timelineElement.domId,
                selector: timelineElement.selector,
                selectorIndex: timelineElement.selectorIndex,
              }
            : timelineElement.selector
              ? {
                  selector: timelineElement.selector,
                  selectorIndex: timelineElement.selectorIndex,
                }
              : null;
          if (!elementTarget) continue;
          const nextZIndex = trackZIndices.get(timelineElement.track);
          if (nextZIndex == null) continue;
          patchedContent = applyPatchByTarget(patchedContent, elementTarget, {
            type: "inline-style",
            property: "z-index",
            value: String(nextZIndex),
          });
        }

        patchedContent = insertTimelineAssetIntoSource(
          patchedContent,
          buildTimelineAssetInsertHtml({
            id: newId,
            assetPath: resolvedAssetSrc,
            kind,
            start: normalizedStart,
            duration: normalizedDuration,
            track: placement.track,
            zIndex: trackZIndices.get(placement.track) ?? 1,
            geometry: resolveTimelineAssetInitialGeometry(originalContent),
          }),
        );

        await saveProjectFilesWithHistory({
          projectId: pid,
          label: "Add timeline asset",
          kind: "timeline",
          files: { [targetPath]: patchedContent },
          readFile: async () => originalContent,
          writeFile: writeProjectFile,
          recordEdit: editHistory.recordEdit,
        });

        setRefreshKey((k) => k + 1);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to drop asset onto timeline";
        showToast(message);
      }
    },
    [activeCompPath, editHistory.recordEdit, showToast, timelineElements, writeProjectFile],
  );

  const handleTimelineFileDrop = useCallback(
    async (files: File[], placement?: Pick<TimelineElement, "start" | "track">) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const uploaded = await uploadProjectFiles(files);
      if (uploaded.length === 0) return;
      const durations: number[] = [];
      for (const assetPath of uploaded) {
        const kind = getTimelineAssetKind(assetPath);
        const duration = kind ? await resolveDroppedAssetDuration(pid, assetPath, kind) : 0;
        durations.push(Number(formatTimelineAttributeNumber(duration)));
      }
      const placements = buildTimelineFileDropPlacements(
        placement ?? { start: 0, track: 0 },
        durations,
        timelineElements
          .filter(
            (timelineElement) =>
              (timelineElement.sourceFile || activeCompPath || "index.html") ===
              (activeCompPath || "index.html"),
          )
          .map((timelineElement) => ({
            start: timelineElement.start,
            duration: timelineElement.duration,
            track: timelineElement.track,
          })),
      );
      for (const [index, assetPath] of uploaded.entries()) {
        await handleTimelineAssetDrop(
          assetPath,
          placements[index] ?? placements[0],
          durations[index],
        );
      }
    },
    [activeCompPath, handleTimelineAssetDrop, timelineElements, uploadProjectFiles],
  );

  // ── File Management Handlers ──

  const handleCreateFile = useCallback(
    async (path: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      let content = "";
      if (path.endsWith(".html")) {
        content =
          '<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="UTF-8">\n</head>\n<body>\n\n</body>\n</html>\n';
      }
      const res = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(path)}`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: content,
      });
      if (res.ok) {
        await refreshFileTree();
        handleFileSelect(path);
      } else {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        console.error(`Create file failed: ${err.error}`);
      }
    },
    [refreshFileTree, handleFileSelect],
  );

  const handleCreateFolder = useCallback(
    async (path: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      // Create a .gitkeep inside the folder so it appears in the tree
      const res = await fetch(
        `/api/projects/${pid}/files/${encodeURIComponent(path + "/.gitkeep")}`,
        {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: "",
        },
      );
      if (res.ok) {
        await refreshFileTree();
      } else {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        console.error(`Create folder failed: ${err.error}`);
      }
    },
    [refreshFileTree],
  );

  const handleDeleteFile = useCallback(
    async (path: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const res = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(path)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        if (editingPathRef.current === path) setEditingFile(null);
        await refreshFileTree();
      } else {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        console.error(`Delete failed: ${err.error}`);
      }
    },
    [refreshFileTree],
  );

  const handleRenameFile = useCallback(
    async (oldPath: string, newPath: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const res = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(oldPath)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPath }),
      });
      if (res.ok) {
        if (editingPathRef.current === oldPath) {
          handleFileSelect(newPath);
        }
        await refreshFileTree();
        // Refresh preview — references in compositions may have been updated
        setRefreshKey((k) => k + 1);
      } else {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        console.error(`Rename failed: ${err.error}`);
      }
    },
    [refreshFileTree, handleFileSelect],
  );

  const handleDuplicateFile = useCallback(
    async (path: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const res = await fetch(`/api/projects/${pid}/duplicate-file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (res.ok) {
        const data = await res.json();
        await refreshFileTree();
        if (data.path) handleFileSelect(data.path);
      } else {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        console.error(`Duplicate failed: ${err.error}`);
      }
    },
    [refreshFileTree, handleFileSelect],
  );

  const handleMoveFile = handleRenameFile;

  const handleImportFiles = useCallback(
    async (files: FileList | File[], dir?: string) => {
      return uploadProjectFiles(Array.from(files), dir);
    },
    [uploadProjectFiles],
  );

  const handleImportFonts = useCallback(
    async (files: FileList | File[]) => {
      const uploaded = await uploadProjectFiles(
        Array.from(files).filter((file) => FONT_EXT.test(file.name)),
        "assets/fonts",
      );
      const pid = projectIdRef.current;
      const imported = uploaded
        .filter((asset) => FONT_EXT.test(asset))
        .map((asset) => ({
          family: fontFamilyFromAssetPath(asset),
          path: asset,
          url: `/api/projects/${pid}/preview/${asset}`,
        }));
      importedFontAssetsRef.current = [
        ...imported,
        ...importedFontAssetsRef.current.filter(
          (existing) =>
            !imported.some((font) => font.family.toLowerCase() === existing.family.toLowerCase()),
        ),
      ];
      return imported;
    },
    [uploadProjectFiles],
  );

  const handleLint = useCallback(async () => {
    const pid = projectIdRef.current;
    if (!pid) return;
    setLinting(true);
    try {
      const res = await fetch(`/api/projects/${pid}/lint`);
      const data = await res.json();
      const findings: LintFinding[] = (data.findings ?? []).map(
        (f: { severity?: string; message?: string; file?: string; fixHint?: string }) => ({
          severity: f.severity === "error" ? ("error" as const) : ("warning" as const),
          message: f.message ?? "",
          file: f.file,
          fixHint: f.fixHint,
        }),
      );
      setLintModal(findings);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLintModal([{ severity: "error", message: `Failed to run lint: ${msg}` }]);
    } finally {
      setLinting(false);
    }
  }, []);

  // Panel resize via pointer events (works for both left sidebar and right panel)
  const handlePanelResizeStart = useCallback(
    (side: "left" | "right", e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      panelDragRef.current = {
        side,
        startX: e.clientX,
        startW: side === "left" ? leftWidth : rightWidth,
      };
    },
    [leftWidth, rightWidth],
  );

  const handlePanelResizeMove = useCallback((e: React.PointerEvent) => {
    const drag = panelDragRef.current;
    if (!drag) return;
    const delta = e.clientX - drag.startX;
    const maxLeft = Math.floor(window.innerWidth * 0.5);
    const newW = Math.max(
      160,
      Math.min(
        drag.side === "left" ? maxLeft : 600,
        drag.startW + (drag.side === "left" ? delta : -delta),
      ),
    );
    if (drag.side === "left") setLeftWidth(newW);
    else setRightWidth(newW);
  }, []);

  const handlePanelResizeEnd = useCallback(() => {
    panelDragRef.current = null;
  }, []);

  const compositions = useMemo(
    () => fileTree.filter((f) => f === "index.html" || f.startsWith("compositions/")),
    [fileTree],
  );
  const assets = useMemo(
    () =>
      fileTree.filter((f) => !f.endsWith(".html") && !f.endsWith(".md") && !f.endsWith(".json")),
    [fileTree],
  );
  const fontAssets = useMemo<ImportedFontAsset[]>(
    () =>
      assets
        .filter((asset) => FONT_EXT.test(asset))
        .map((asset) => ({
          family: fontFamilyFromAssetPath(asset),
          path: asset,
          url: `/api/projects/${projectId}/preview/${asset}`,
        })),
    [assets, projectId],
  );

  if (resolving || !projectId) {
    return (
      <div className="h-full w-full bg-neutral-950 flex items-center justify-center">
        <div className="w-4 h-4 rounded-full bg-studio-accent animate-pulse" />
      </div>
    );
  }

  // At this point projectId is guaranteed non-null (narrowed by the guard above)

  return (
    <div
      className="flex flex-col h-full w-full bg-neutral-950 relative"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
      }}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        dragCounterRef.current++;
        setGlobalDragOver(true);
      }}
      onDragLeave={() => {
        dragCounterRef.current--;
        if (dragCounterRef.current === 0) setGlobalDragOver(false);
      }}
      onDrop={(e) => {
        dragCounterRef.current = 0;
        setGlobalDragOver(false);
        // Skip if a child (e.g. AssetsTab) already handled the drop
        if (e.defaultPrevented) return;
        e.preventDefault();
        if (e.dataTransfer.files.length) handleImportFiles(e.dataTransfer.files);
      }}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between h-10 px-3 bg-neutral-900 border-b border-neutral-800 flex-shrink-0">
        {/* Left: project name */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-neutral-400">{projectId}</span>
        </div>
        {/* Right: toolbar buttons */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void handleUndo()}
            disabled={!editHistory.canUndo}
            className={`h-7 w-7 flex items-center justify-center rounded-md border transition-colors ${
              editHistory.canUndo
                ? "border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:bg-neutral-800"
                : "border-neutral-900 text-neutral-700"
            }`}
            title={
              editHistory.undoLabel
                ? `Undo ${editHistory.undoLabel} (${getHistoryShortcutLabel("undo")})`
                : `Undo (${getHistoryShortcutLabel("undo")})`
            }
            aria-label="Undo"
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            onClick={() => void handleRedo()}
            disabled={!editHistory.canRedo}
            className={`h-7 w-7 flex items-center justify-center rounded-md border transition-colors ${
              editHistory.canRedo
                ? "border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:bg-neutral-800"
                : "border-neutral-900 text-neutral-700"
            }`}
            title={
              editHistory.redoLabel
                ? `Redo ${editHistory.redoLabel} (${getHistoryShortcutLabel("redo")})`
                : `Redo (${getHistoryShortcutLabel("redo")})`
            }
            aria-label="Redo"
          >
            <RotateCw size={14} />
          </button>
          <a
            href={captureFrameHref}
            download={captureFrameFilename}
            onClick={handleCaptureFrameClick}
            onFocus={refreshCaptureFrameTime}
            onPointerDown={refreshCaptureFrameTime}
            className="h-7 flex items-center gap-1.5 px-2.5 rounded-md text-[11px] font-medium border border-neutral-700 text-neutral-300 transition-colors hover:border-neutral-500 hover:bg-neutral-800"
            title="Capture current frame"
            aria-label="Capture current frame"
          >
            <Camera size={14} />
            <span>Capture</span>
          </a>
          <button
            onClick={() => {
              if (rightCollapsed || rightPanelTab !== "design") {
                setRightPanelTab("design");
                setRightCollapsed(false);
                return;
              }
              clearDomSelection();
              setRightCollapsed(true);
            }}
            className={`h-7 flex items-center gap-1.5 px-2.5 rounded-md text-[11px] font-medium border transition-colors ${
              !rightCollapsed
                ? "text-studio-accent bg-studio-accent/10 border-studio-accent/30"
                : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 border-transparent"
            }`}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <polygon points="10 8 16 12 10 16" fill="currentColor" stroke="none" />
            </svg>
            Inspector
          </button>
        </div>
      </div>

      {/* Main content: sidebar + preview + right panel */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar: Compositions + Assets (resizable, collapsible) */}
        {leftCollapsed ? (
          <div className="flex w-10 flex-shrink-0 flex-col items-center border-r border-neutral-800/50 bg-neutral-950 pt-1">
            <button
              type="button"
              onClick={toggleLeftSidebar}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-neutral-500 transition-colors hover:border-neutral-800 hover:bg-neutral-900 hover:text-neutral-300"
              title="Show sidebar"
              aria-label="Show sidebar"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 4v16" />
                <path d="m10 7 5 5-5 5" />
              </svg>
            </button>
          </div>
        ) : (
          <LeftSidebar
            width={leftWidth}
            projectId={projectId}
            compositions={compositions}
            assets={assets}
            activeComposition={editingFile?.path ?? null}
            onSelectComposition={(comp) => {
              // Set active composition for preview drill-down
              // Don't increment refreshKey — that reloads the master iframe and
              // overrides the composition navigation. Let activeCompositionPath
              // handle the preview change via the composition stack.
              setActiveCompPath(
                comp === "index.html" || comp.startsWith("compositions/") ? comp : null,
              );
              // Load file content for code editor
              setEditingFile({ path: comp, content: null });
              fetch(`/api/projects/${projectId}/files/${comp}`)
                .then((r) => r.json())
                .then((data) => setEditingFile({ path: comp, content: data.content }))
                .catch(() => {});
            }}
            fileTree={fileTree}
            editingFile={editingFile}
            onSelectFile={handleFileSelect}
            onCreateFile={handleCreateFile}
            onCreateFolder={handleCreateFolder}
            onDeleteFile={handleDeleteFile}
            onRenameFile={handleRenameFile}
            onDuplicateFile={handleDuplicateFile}
            onMoveFile={handleMoveFile}
            onImportFiles={handleImportFiles}
            codeChildren={
              editingFile ? (
                isMediaFile(editingFile.path) ? (
                  <MediaPreview projectId={projectId ?? ""} filePath={editingFile.path} />
                ) : (
                  <SourceEditor
                    content={editingFile.content ?? ""}
                    filePath={editingFile.path}
                    onChange={handleContentChange}
                  />
                )
              ) : undefined
            }
            onLint={handleLint}
            linting={linting}
            onToggleCollapse={toggleLeftSidebar}
          />
        )}

        {/* Left resize handle */}
        {!leftCollapsed && (
          <div
            className="group w-2 flex-shrink-0 cursor-col-resize flex items-center justify-center"
            style={{ touchAction: "none" }}
            onPointerDown={(e) => handlePanelResizeStart("left", e)}
            onPointerMove={handlePanelResizeMove}
            onPointerUp={handlePanelResizeEnd}
          >
            <div className="h-[52px] w-px bg-white/12 transition-colors group-hover:bg-white/18 group-active:bg-white/24" />
          </div>
        )}

        {/* Center: Preview */}
        <div className="flex-1 relative min-w-0">
          <NLELayout
            projectId={projectId}
            refreshKey={refreshKey}
            activeCompositionPath={activeCompPath}
            timelineToolbar={timelineToolbar}
            renderClipContent={renderClipContent}
            onDeleteElement={handleTimelineElementDelete}
            onAssetDrop={handleTimelineAssetDrop}
            onFileDrop={handleTimelineFileDrop}
            onMoveElement={handleTimelineElementMove}
            onResizeElement={handleTimelineElementResize}
            onBlockedEditAttempt={handleBlockedTimelineEdit}
            onCompIdToSrcChange={setCompIdToSrc}
            onCompositionChange={(compPath) => {
              // Sync activeCompPath when user drills down via timeline double-click
              // or navigates back via breadcrumb — keeps sidebar + thumbnails in sync.
              setActiveCompPath(compPath);
            }}
            onIframeRef={handlePreviewIframeRef}
            previewOverlay={
              captionEditMode ? (
                <CaptionOverlay iframeRef={previewIframeRef} />
              ) : (
                <DomEditOverlay
                  iframeRef={previewIframeRef}
                  activeCompositionPath={activeCompPath}
                  hoverSelection={captionEditMode ? null : domEditHoverSelection}
                  selection={
                    !rightCollapsed && rightPanelTab === "design" ? domEditSelection : null
                  }
                  groupSelections={
                    !rightCollapsed && rightPanelTab === "design" ? domEditGroupSelections : []
                  }
                  allowCanvasMovement
                  onCanvasMouseDown={handlePreviewCanvasMouseDown}
                  onCanvasPointerMove={handlePreviewCanvasPointerMove}
                  onCanvasPointerLeave={handlePreviewCanvasPointerLeave}
                  onSelectionChange={applyDomSelection}
                  onBlockedMove={handleBlockedDomMove}
                  onManualDragStart={handleDomManualDragStart}
                  onPathOffsetCommit={handleDomPathOffsetCommit}
                  onGroupPathOffsetCommit={handleDomGroupPathOffsetCommit}
                  onBoxSizeCommit={handleDomBoxSizeCommit}
                  onRotationCommit={handleDomRotationCommit}
                />
              )
            }
            timelineFooter={
              captionEditMode ? (
                <div
                  className="border-t border-neutral-800/30 flex-shrink-0"
                  style={{ height: 60 }}
                >
                  <div className="flex items-center gap-1.5 px-2 py-0.5">
                    <span className="text-[9px] font-medium text-neutral-500 uppercase tracking-wider">
                      Captions
                    </span>
                  </div>
                  <CaptionTimeline pixelsPerSecond={100} />
                </div>
              ) : undefined
            }
            timelineVisible={timelineVisible}
            onToggleTimeline={toggleTimelineVisibility}
          />
        </div>

        {/* Right panel: Renders-only (resizable, collapsible via header Renders button) */}
        {!rightCollapsed && (
          <>
            <div
              className="group w-2 flex-shrink-0 cursor-col-resize flex items-center justify-center"
              style={{ touchAction: "none" }}
              onPointerDown={(e) => handlePanelResizeStart("right", e)}
              onPointerMove={handlePanelResizeMove}
              onPointerUp={handlePanelResizeEnd}
            >
              <div className="h-[52px] w-px bg-white/12 transition-colors group-hover:bg-white/18 group-active:bg-white/24" />
            </div>
            <div
              className="flex flex-col border-l border-neutral-800 bg-neutral-900 flex-shrink-0"
              style={{ width: rightWidth }}
            >
              {captionEditMode ? (
                <CaptionPropertyPanel iframeRef={previewIframeRef} />
              ) : (
                <>
                  <div className="flex items-center gap-1 border-b border-neutral-800 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setRightPanelTab("design")}
                      className={`h-8 rounded-xl px-3 text-[11px] font-medium transition-colors ${
                        rightPanelTab === "design"
                          ? "bg-neutral-800 text-white"
                          : "text-neutral-500 hover:bg-neutral-800/70 hover:text-neutral-200"
                      }`}
                    >
                      Design
                    </button>
                    <button
                      type="button"
                      onClick={() => setRightPanelTab("renders")}
                      className={`h-8 rounded-xl px-3 text-[11px] font-medium transition-colors ${
                        rightPanelTab === "renders"
                          ? "bg-neutral-800 text-white"
                          : "text-neutral-500 hover:bg-neutral-800/70 hover:text-neutral-200"
                      }`}
                    >
                      {renderQueue.jobs.length > 0
                        ? `Renders (${renderQueue.jobs.length})`
                        : "Renders"}
                    </button>
                  </div>
                  <div className="min-h-0 flex-1">
                    {rightPanelTab === "design" ? (
                      <PropertyPanel
                        projectId={projectId}
                        assets={assets}
                        element={domEditGroupSelections.length > 1 ? null : domEditSelection}
                        copiedAgentPrompt={copiedAgentPrompt}
                        onClearSelection={clearDomSelection}
                        onSetStyle={handleDomStyleCommit}
                        onSetManualOffset={handleDomPathOffsetCommit}
                        onSetManualSize={handleDomBoxSizeCommit}
                        onSetText={handleDomTextCommit}
                        onSetTextFieldStyle={handleDomTextFieldStyleCommit}
                        onAddTextField={handleDomAddTextField}
                        onRemoveTextField={handleDomRemoveTextField}
                        onResetManualEdits={handleDomManualEditsReset}
                        onAskAgent={handleAskAgent}
                        onImportAssets={handleImportFiles}
                        fontAssets={fontAssets}
                        onImportFonts={handleImportFonts}
                      />
                    ) : (
                      <RenderQueue
                        jobs={renderQueue.jobs}
                        projectId={projectId}
                        onDelete={renderQueue.deleteRender}
                        onClearCompleted={renderQueue.clearCompleted}
                        onStartRender={async (format, quality) => {
                          await waitForPendingDomEditSaves();
                          await renderQueue.startRender(30, quality, format);
                        }}
                        isRendering={renderQueue.isRendering}
                      />
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Lint modal */}
      {lintModal !== null && projectId && (
        <LintModal findings={lintModal} projectId={projectId} onClose={() => setLintModal(null)} />
      )}

      {/* Console errors modal — auto-shows when composition has runtime errors */}
      {consoleErrors !== null && consoleErrors.length > 0 && projectId && (
        <LintModal
          findings={consoleErrors}
          projectId={projectId}
          onClose={() => setConsoleErrors(null)}
        />
      )}

      {/* Ask agent modal */}
      {agentModalOpen && domEditSelection && (
        <AskAgentModal
          selectionLabel={domEditSelection.label}
          onSubmit={handleAgentModalSubmit}
          onClose={() => setAgentModalOpen(false)}
        />
      )}

      {/* Global drag-drop overlay */}
      {globalDragOver && (
        <div className="absolute inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm pointer-events-none">
          <div className="flex flex-col items-center gap-3 px-8 py-6 rounded-xl border-2 border-dashed border-studio-accent/60 bg-studio-accent/[0.06]">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-studio-accent"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span className="text-sm font-medium text-studio-accent">
              Drop files to import into project
            </span>
          </div>
        </div>
      )}
      {appToast && (
        <div
          className={`absolute bottom-6 left-1/2 -translate-x-1/2 z-[91] px-4 py-2 rounded-lg border text-sm shadow-lg animate-in fade-in slide-in-from-bottom-2 ${
            appToast.tone === "error"
              ? "bg-red-900/90 border-red-700/50 text-red-200"
              : "bg-neutral-900/95 border-neutral-700/60 text-neutral-100"
          }`}
        >
          {appToast.message}
        </div>
      )}
    </div>
  );
}
