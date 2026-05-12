import { useState, useCallback, useRef, useEffect } from "react";
import type { TimelineElement } from "../player";
import { liveTime, usePlayerStore } from "../player";
import { FONT_EXT } from "../utils/mediaTypes";
import { copyTextToClipboard } from "../utils/clipboard";
import {
  applyPatchByTarget,
  readTagSnippetByTarget,
  type PatchOperation,
} from "../utils/sourcePatcher";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import { confirmElementDelete } from "../utils/studioHelpers";
import {
  STUDIO_INSPECTOR_PANELS_ENABLED,
  STUDIO_PREVIEW_SELECTION_ENABLED,
} from "../components/editor/manualEditingAvailability";
import {
  buildDomEditStylePatchOperation,
  buildDomEditTextPatchOperation,
  buildElementAgentPrompt,
  findElementForSelection,
  findElementForTimelineElement,
  getDomEditTargetKey,
  isLargeRasterDomEditSelection,
  isTextEditableSelection,
  resolveVisualDomEditSelectionTarget,
  serializeDomEditTextFields,
  resolveDomEditSelection,
  buildDefaultDomEditTextField,
  type DomEditViewport,
  type DomEditTextField,
  type DomEditSelection,
} from "../components/editor/domEditing";
import {
  removeStudioManualEditsForSelection,
  type StudioManualEditManifest,
  upsertStudioBoxSizeEdit,
  upsertStudioPathOffsetEdit,
  upsertStudioRotationEdit,
} from "../components/editor/manualEdits";
import {
  removeStudioMotionForSelection,
  type StudioGsapMotion,
  type StudioMotionManifest,
  upsertStudioGsapMotion,
} from "../components/editor/studioMotion";
import { googleFontStylesheetUrl } from "../components/editor/fontCatalog";
import {
  fontFamilyFromAssetPath,
  importedFontFaceCss,
  type ImportedFontAsset,
} from "../components/editor/fontAssets";
import type { DomEditGroupPathOffsetCommit } from "../components/editor/DomEditOverlay";
import type { EditHistoryKind } from "../utils/editHistory";

// ── Types ──

export type RightPanelTab = "design" | "motion" | "renders";

interface AgentModalAnchorPoint {
  x: number;
  y: number;
}

interface PreviewLocalPointer {
  x: number;
  y: number;
  viewport: DomEditViewport;
}

interface RecordEditInput {
  label: string;
  kind: EditHistoryKind;
  coalesceKey?: string;
  files: Record<string, { before: string; after: string }>;
}

export interface UseDomEditSessionParams {
  projectId: string | null;
  activeCompPath: string | null;
  isMasterView: boolean;
  compIdToSrc: Map<string, string>;
  captionEditMode: boolean;
  compositionLoading: boolean;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  timelineElements: TimelineElement[];
  currentTime: number;
  setSelectedTimelineElementId: (id: string | null) => void;
  setRightCollapsed: (collapsed: boolean) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  showToast: (message: string, tone?: "error" | "info") => void;
  refreshPreviewDocumentVersion: () => void;
  commitStudioManualEditManifestOptimistically: (
    updateManifest: (manifest: StudioManualEditManifest) => StudioManualEditManifest,
    options: { label: string; coalesceKey: string },
  ) => void;
  commitStudioMotionManifestOptimistically: (
    updateManifest: (manifest: StudioMotionManifest) => StudioMotionManifest,
    options: { label: string; coalesceKey: string },
  ) => void;
  applyCurrentStudioManualEditsToPreview: (iframe: HTMLIFrameElement | null) => void;
  applyCurrentStudioMotionToPreview: (iframe: HTMLIFrameElement | null) => void;
  readProjectFile: (path: string) => Promise<string>;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  domEditSaveTimestampRef: React.MutableRefObject<number>;
  editHistory: { recordEdit: (entry: RecordEditInput) => Promise<void> };
  fileTree: string[];
  importedFontAssetsRef: React.MutableRefObject<ImportedFontAsset[]>;
  projectDir: string | null;
  projectIdRef: React.MutableRefObject<string | null>;
  previewIframe: HTMLIFrameElement | null;
  refreshKey: number;
  rightPanelTab: RightPanelTab;
  applyStudioManualEditsToPreviewRef: React.MutableRefObject<
    (iframe: HTMLIFrameElement) => Promise<void>
  >;
  applyStudioMotionToPreviewRef: React.MutableRefObject<
    (iframe: HTMLIFrameElement) => Promise<void>
  >;
  syncPreviewHistoryHotkey: (iframe: HTMLIFrameElement | null) => void;
  setRefreshKey: React.Dispatch<React.SetStateAction<number>>;
}

// ── Local helpers ──

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

  if (
    ["border-radius", "border-width", "font-size", "letter-spacing"].includes(property) &&
    /^-?\d+(\.\d+)?$/.test(trimmed)
  ) {
    return `${trimmed}px`;
  }

  return trimmed;
}

function isImageBackgroundValue(value: string): boolean {
  return /^url\(/i.test(value.trim());
}

function isManualGeometryStyleProperty(property: string): boolean {
  return property === "left" || property === "top" || property === "width" || property === "height";
}

function resolvePreviewLocalPointer(
  iframe: HTMLIFrameElement,
  doc: Document,
  win: Window,
  clientX: number,
  clientY: number,
): PreviewLocalPointer | null {
  const iframeRect = iframe.getBoundingClientRect();
  const root =
    doc.querySelector<HTMLElement>("[data-composition-id]") ?? doc.documentElement ?? null;
  const rootRect = root?.getBoundingClientRect();
  const rootWidth = rootRect?.width || win.innerWidth;
  const rootHeight = rootRect?.height || win.innerHeight;
  if (!rootWidth || !rootHeight) return null;

  const scaleX = iframeRect.width / rootWidth;
  const scaleY = iframeRect.height / rootHeight;
  return {
    x: (clientX - iframeRect.left) / scaleX,
    y: (clientY - iframeRect.top) / scaleY,
    viewport: { width: rootWidth, height: rootHeight },
  };
}

function getPreviewLocalPointer(
  iframe: HTMLIFrameElement,
  clientX: number,
  clientY: number,
): PreviewLocalPointer | null {
  let doc: Document | null = null;
  let win: Window | null = null;
  try {
    doc = iframe.contentDocument;
    win = iframe.contentWindow;
  } catch {
    return null;
  }
  if (!doc || !win) return null;

  return resolvePreviewLocalPointer(iframe, doc, win, clientX, clientY);
}

function getPreviewTargetFromPointer(
  iframe: HTMLIFrameElement,
  clientX: number,
  clientY: number,
  activeCompositionPath: string | null,
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

  const localPointer = resolvePreviewLocalPointer(iframe, doc, win, clientX, clientY);
  if (!localPointer) return null;

  if (typeof doc.elementsFromPoint === "function") {
    const visualTarget = resolveVisualDomEditSelectionTarget(
      doc.elementsFromPoint(localPointer.x, localPointer.y),
      {
        activeCompositionPath,
      },
    );
    if (visualTarget) return visualTarget;
  }

  const target = doc.elementFromPoint(localPointer.x, localPointer.y);
  if (!target || typeof target !== "object") return null;
  const maybeNode = target as { nodeType?: number; parentElement?: Element | null };
  if (maybeNode.nodeType === 1) return target as HTMLElement;
  if (maybeNode.nodeType === 3 && maybeNode.parentElement) {
    return maybeNode.parentElement as HTMLElement;
  }
  return null;
}

function buildRasterClickSelectionContext(
  selection: DomEditSelection,
  localPointer: PreviewLocalPointer,
): string {
  return [
    "The user clicked a large raster/background element in the Studio preview.",
    `Preview click: x=${Math.round(localPointer.x)}px, y=${Math.round(localPointer.y)}px in a ${Math.round(
      localPointer.viewport.width,
    )}x${Math.round(localPointer.viewport.height)} composition.`,
    `Selected target: <${selection.tagName}> ${selection.selector ?? selection.id ?? selection.label}.`,
    "Visible copy or artwork at that point may be baked into the selected image/background rather than a selectable DOM text layer.",
    "If the request mentions text seen at the click location, inspect or replace the image asset, or recreate that visible copy as editable DOM.",
  ].join("\n");
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

// ── Hook ──

export function useDomEditSession({
  projectId,
  activeCompPath,
  isMasterView,
  compIdToSrc,
  captionEditMode,
  compositionLoading,
  previewIframeRef,
  timelineElements,
  currentTime,
  setSelectedTimelineElementId,
  setRightCollapsed,
  setRightPanelTab,
  showToast,
  refreshPreviewDocumentVersion,
  commitStudioManualEditManifestOptimistically,
  commitStudioMotionManifestOptimistically,
  applyCurrentStudioManualEditsToPreview,
  applyCurrentStudioMotionToPreview,
  readProjectFile: _readProjectFile,
  writeProjectFile,
  domEditSaveTimestampRef,
  editHistory,
  fileTree,
  importedFontAssetsRef,
  projectDir,
  projectIdRef,
  previewIframe,
  refreshKey,
  rightPanelTab,
  applyStudioManualEditsToPreviewRef,
  applyStudioMotionToPreviewRef,
  syncPreviewHistoryHotkey,
  setRefreshKey,
}: UseDomEditSessionParams) {
  // ── State ──

  const [domEditSelection, setDomEditSelection] = useState<DomEditSelection | null>(null);
  const [domEditGroupSelections, setDomEditGroupSelections] = useState<DomEditSelection[]>([]);
  const [domEditHoverSelection, setDomEditHoverSelection] = useState<DomEditSelection | null>(null);
  const [agentPromptTagSnippet, setAgentPromptTagSnippet] = useState<string | undefined>();
  const [agentPromptSelectionContext, setAgentPromptSelectionContext] = useState<
    string | undefined
  >();
  const [agentModalAnchorPoint, setAgentModalAnchorPoint] = useState<AgentModalAnchorPoint | null>(
    null,
  );
  const [copiedAgentPrompt, setCopiedAgentPrompt] = useState(false);
  const [agentModalOpen, setAgentModalOpen] = useState(false);

  // ── Refs ──

  const domEditSelectionRef = useRef<DomEditSelection | null>(domEditSelection);
  const domEditGroupSelectionsRef = useRef<DomEditSelection[]>(domEditGroupSelections);
  const domEditHoverSelectionRef = useRef<DomEditSelection | null>(domEditHoverSelection);
  const copiedAgentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const domTextCommitVersionRef = useRef(0);

  // Keep refs in sync with state
  domEditSelectionRef.current = domEditSelection;
  domEditGroupSelectionsRef.current = domEditGroupSelections;
  domEditHoverSelectionRef.current = domEditHoverSelection;

  // ── Callbacks ──

  const applyDomSelection = useCallback(
    (
      selection: DomEditSelection | null,
      options?: { revealPanel?: boolean; additive?: boolean; preserveGroup?: boolean },
    ) => {
      setAgentPromptTagSnippet(undefined);
      setAgentPromptSelectionContext(undefined);
      setAgentModalAnchorPoint(null);
      setCopiedAgentPrompt(false);
      if (!selection) {
        domEditSelectionRef.current = null;
        domEditGroupSelectionsRef.current = [];
        setDomEditSelection(null);
        setDomEditGroupSelections([]);
        setSelectedTimelineElementId(null);
        return;
      }
      if (!STUDIO_INSPECTOR_PANELS_ENABLED) {
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
    [setSelectedTimelineElementId, timelineElements, setRightCollapsed, setRightPanelTab],
  );

  const clearDomSelection = useCallback(() => {
    applyDomSelection(null, { revealPanel: false });
  }, [applyDomSelection]);

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
      const target = getPreviewTargetFromPointer(iframe, clientX, clientY, activeCompPath);
      if (!target) return null;
      return buildDomSelectionFromTarget(target, {
        preferClipAncestor: options?.preferClipAncestor,
      });
    },
    [activeCompPath, buildDomSelectionFromTarget, captionEditMode, previewIframeRef],
  );

  const updateDomEditHoverSelection = useCallback((selection: DomEditSelection | null) => {
    if (domEditSelectionsTargetSame(domEditHoverSelectionRef.current, selection)) return;
    domEditHoverSelectionRef.current = selection;
    setDomEditHoverSelection(selection);
  }, []);

  const buildDomSelectionForTimelineElement = useCallback(
    (element: TimelineElement): DomEditSelection | null => {
      const iframe = previewIframeRef.current;
      let doc: Document | null = null;
      try {
        doc = iframe?.contentDocument ?? null;
      } catch {
        return null;
      }
      if (!doc) return null;

      const targetElement = findElementForTimelineElement(doc, element, {
        activeCompositionPath: activeCompPath,
        compIdToSrc,
        isMasterView,
      });
      return targetElement
        ? buildDomSelectionFromTarget(targetElement, { preferClipAncestor: false })
        : null;
    },
    [activeCompPath, buildDomSelectionFromTarget, compIdToSrc, isMasterView, previewIframeRef],
  );

  const handleTimelineElementSelect = useCallback(
    (element: TimelineElement | null) => {
      if (!STUDIO_INSPECTOR_PANELS_ENABLED) return;
      if (!element) {
        applyDomSelection(null, { revealPanel: false });
        return;
      }

      const selection = buildDomSelectionForTimelineElement(element);
      if (selection) applyDomSelection(selection);
    },
    [applyDomSelection, buildDomSelectionForTimelineElement],
  );

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
    [activeCompPath, projectIdRef],
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
    [fileTree, projectId, importedFontAssetsRef],
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
    [
      activeCompPath,
      editHistory.recordEdit,
      writeProjectFile,
      projectIdRef,
      domEditSaveTimestampRef,
      setRefreshKey,
    ],
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
    [activeCompPath, applyDomSelection, buildDomSelectionFromTarget, previewIframeRef],
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
    [
      activeCompPath,
      buildDomSelectionFromTarget,
      setSelectedTimelineElementId,
      timelineElements,
      previewIframeRef,
    ],
  );

  const handleDomManualDragStart = useCallback(() => {
    const pausedTime = pauseStudioPreviewPlayback(previewIframeRef.current);
    const playerStore = usePlayerStore.getState();
    playerStore.setIsPlaying(false);
    if (pausedTime != null) {
      playerStore.setCurrentTime(pausedTime);
      liveTime.notify(pausedTime);
    }
  }, [previewIframeRef]);

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
      previewIframeRef,
    ],
  );

  const handleDomMotionCommit = useCallback(
    (
      selection: DomEditSelection,
      motion: Omit<StudioGsapMotion, "kind" | "target" | "updatedAt">,
    ) => {
      commitStudioMotionManifestOptimistically(
        (manifest) => upsertStudioGsapMotion(manifest, selection, motion),
        {
          label: "Set GSAP motion",
          coalesceKey: `motion:${getDomEditTargetKey(selection)}`,
        },
      );
      refreshDomEditSelectionFromPreview(selection);
    },
    [commitStudioMotionManifestOptimistically, refreshDomEditSelectionFromPreview],
  );

  const handleDomMotionClear = useCallback(
    (selection: DomEditSelection) => {
      commitStudioMotionManifestOptimistically(
        (manifest) => removeStudioMotionForSelection(manifest, selection),
        {
          label: "Clear GSAP motion",
          coalesceKey: `motion:${getDomEditTargetKey(selection)}`,
        },
      );
      applyCurrentStudioMotionToPreview(previewIframeRef.current);
      refreshDomEditSelectionFromPreview(selection);
    },
    [
      applyCurrentStudioMotionToPreview,
      commitStudioMotionManifestOptimistically,
      refreshDomEditSelectionFromPreview,
      previewIframeRef,
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
      try {
        await persistDomEditOperations(domEditSelection, operations, {
          label: "Edit layer style",
          skipRefresh: true,
          prepareContent: importedFont
            ? (html, sourceFile) => ensureImportedFontFace(html, importedFont, sourceFile)
            : undefined,
        });
      } catch (err) {
        console.warn("[Studio] Style persist failed:", err instanceof Error ? err.message : err);
      }
      refreshDomEditSelectionFromPreview(domEditSelection);
    },
    [
      activeCompPath,
      domEditSelection,
      persistDomEditOperations,
      refreshDomEditSelectionFromPreview,
      resolveImportedFontAsset,
      previewIframeRef,
    ],
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
      previewIframeRef,
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
    [
      activeCompPath,
      applyDomSelection,
      buildDomSelectionFromTarget,
      persistDomEditOperations,
      previewIframeRef,
    ],
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
    [
      commitDomTextFields,
      domEditSelection,
      handleDomStyleCommit,
      resolveImportedFontAsset,
      previewIframeRef,
    ],
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
    setAgentPromptSelectionContext(undefined);
    setAgentModalAnchorPoint(null);
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
        selectionContext: agentPromptSelectionContext,
        userInstruction,
        sourceFilePath: toProjectAbsolutePath(projectDir, targetPath),
      });

      const copied = await copyTextToClipboard(prompt);
      if (!copied) {
        showToast("Could not copy prompt to clipboard.", "error");
        return;
      }

      setAgentModalOpen(false);
      setAgentPromptSelectionContext(undefined);
      setAgentModalAnchorPoint(null);
      if (copiedAgentTimerRef.current) clearTimeout(copiedAgentTimerRef.current);
      setCopiedAgentPrompt(true);
      copiedAgentTimerRef.current = setTimeout(() => setCopiedAgentPrompt(false), 1600);
    },
    [
      activeCompPath,
      agentPromptSelectionContext,
      agentPromptTagSnippet,
      currentTime,
      domEditSelection,
      projectDir,
      showToast,
    ],
  );

  const handlePreviewCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, options?: { preferClipAncestor?: boolean }) => {
      if (!STUDIO_PREVIEW_SELECTION_ENABLED || captionEditMode || compositionLoading) return;
      const nextSelection = resolveDomSelectionFromPreviewPoint(e.clientX, e.clientY, {
        preferClipAncestor: options?.preferClipAncestor ?? false,
      });
      if (!nextSelection) {
        if (!e.shiftKey) applyDomSelection(null, { revealPanel: false });
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const localPointer = previewIframeRef.current
        ? getPreviewLocalPointer(previewIframeRef.current, e.clientX, e.clientY)
        : null;
      applyDomSelection(nextSelection, { additive: e.shiftKey });
      if (
        !e.shiftKey &&
        localPointer &&
        isLargeRasterDomEditSelection(nextSelection, localPointer.viewport)
      ) {
        setAgentPromptSelectionContext(
          buildRasterClickSelectionContext(nextSelection, localPointer),
        );
        setAgentModalAnchorPoint({ x: e.clientX, y: e.clientY });
        void preloadAgentPromptSnippet(nextSelection);
        setAgentModalOpen(true);
      }
    },
    [
      applyDomSelection,
      captionEditMode,
      compositionLoading,
      preloadAgentPromptSnippet,
      resolveDomSelectionFromPreviewPoint,
      previewIframeRef,
    ],
  );

  const handlePreviewCanvasPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, options?: { preferClipAncestor?: boolean }) => {
      if (!STUDIO_PREVIEW_SELECTION_ENABLED || captionEditMode || compositionLoading) {
        updateDomEditHoverSelection(null);
        return null;
      }

      const nextSelection = resolveDomSelectionFromPreviewPoint(e.clientX, e.clientY, {
        preferClipAncestor: options?.preferClipAncestor ?? false,
      });
      updateDomEditHoverSelection(nextSelection);
      return nextSelection;
    },
    [
      captionEditMode,
      compositionLoading,
      resolveDomSelectionFromPreviewPoint,
      updateDomEditHoverSelection,
    ],
  );

  const handlePreviewCanvasPointerLeave = useCallback(() => {
    updateDomEditHoverSelection(null);
  }, [updateDomEditHoverSelection]);

  const handleBlockedDomMove = useCallback(
    (selection: DomEditSelection) => {
      showToast(
        selection.capabilities.reasonIfDisabled ??
          "This element can't be adjusted directly from the preview.",
        "info",
      );
    },
    [showToast],
  );

  // ── Effects ──

  // Clear hover on caption mode change
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (captionEditMode) updateDomEditHoverSelection(null);
  }, [captionEditMode, updateDomEditHoverSelection]);

  // Clear hover on composition/project/preview change
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    updateDomEditHoverSelection(null);
  }, [activeCompPath, projectId, previewIframe, refreshKey, updateDomEditHoverSelection]);

  // Clear hover when matching selection
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

  // Clear hover when element disconnected
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!domEditHoverSelection) return;
    if (domEditHoverSelection.element.isConnected) return;
    updateDomEditHoverSelection(null);
  }, [domEditHoverSelection, updateDomEditHoverSelection]);

  // Sync selection from preview document (the big one with attachErrorCapture)
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!previewIframe) return;

    const syncSelectionFromDocument = () => {
      if (!STUDIO_INSPECTOR_PANELS_ENABLED || captionEditMode) return;
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

    syncPreviewHistoryHotkey(previewIframe);
    void (async () => {
      await applyStudioManualEditsToPreviewRef.current(previewIframe);
      await applyStudioMotionToPreviewRef.current(previewIframe);
    })();
    syncSelectionFromDocument();
    refreshPreviewDocumentVersion();

    const handleLoad = () => {
      syncPreviewHistoryHotkey(previewIframe);
      void (async () => {
        await applyStudioManualEditsToPreviewRef.current(previewIframe);
        await applyStudioMotionToPreviewRef.current(previewIframe);
      })();
      syncSelectionFromDocument();
      refreshPreviewDocumentVersion();
    };

    previewIframe.addEventListener("load", handleLoad);
    return () => {
      previewIframe.removeEventListener("load", handleLoad);
    };
  }, [
    activeCompPath,
    applyDomSelection,
    buildDomSelectionFromTarget,
    captionEditMode,
    previewIframe,
    refreshPreviewDocumentVersion,
    syncPreviewHistoryHotkey,
    applyStudioManualEditsToPreviewRef,
    applyStudioMotionToPreviewRef,
  ]);

  // Clear selection on caption mode change
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!captionEditMode) return;
    applyDomSelection(null, { revealPanel: false });
  }, [applyDomSelection, captionEditMode]);

  // Disabled inspector effect
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (STUDIO_INSPECTOR_PANELS_ENABLED) return;
    updateDomEditHoverSelection(null);
    applyDomSelection(null, { revealPanel: false });
    if (rightPanelTab !== "renders") setRightPanelTab("renders");
  }, [applyDomSelection, rightPanelTab, updateDomEditHoverSelection, setRightPanelTab]);

  // Cleanup copiedAgentTimerRef
  // eslint-disable-next-line no-restricted-syntax
  useEffect(
    () => () => {
      if (copiedAgentTimerRef.current) clearTimeout(copiedAgentTimerRef.current);
    },
    [],
  );

  const handleDomEditElementDelete = useCallback(
    async (selection: DomEditSelection) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const label = selection.label || selection.id || selection.selector || selection.tagName;
      if (!confirmElementDelete(label, "element")) return;

      const targetPath = selection.sourceFile || activeCompPath || "index.html";
      try {
        const response = await fetch(
          `/api/projects/${pid}/files/${encodeURIComponent(targetPath)}`,
        );
        if (!response.ok) throw new Error(`Failed to read ${targetPath}`);

        const data = (await response.json()) as { content?: string };
        const originalContent = data.content;
        if (typeof originalContent !== "string")
          throw new Error(`Missing file contents for ${targetPath}`);

        const patchTarget: { id?: string; selector?: string; selectorIndex?: number } = selection.id
          ? {
              id: selection.id,
              selector: selection.selector,
              selectorIndex: selection.selectorIndex,
            }
          : selection.selector
            ? { selector: selection.selector, selectorIndex: selection.selectorIndex }
            : ({} as never);
        if (!patchTarget.id && !patchTarget.selector) {
          throw new Error("Selected element has no patchable target");
        }

        const removeResponse = await fetch(
          `/api/projects/${pid}/file-mutations/remove-element/${encodeURIComponent(targetPath)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target: patchTarget }),
          },
        );
        if (!removeResponse.ok) throw new Error(`Failed to delete element from ${targetPath}`);

        const removeData = (await removeResponse.json()) as { changed?: boolean; content?: string };
        const patchedContent =
          typeof removeData.content === "string" ? removeData.content : originalContent;

        domEditSaveTimestampRef.current = Date.now();
        await saveProjectFilesWithHistory({
          projectId: pid,
          label: "Delete element",
          kind: "timeline",
          files: { [targetPath]: patchedContent },
          readFile: async () => originalContent,
          writeFile: writeProjectFile,
          recordEdit: editHistory.recordEdit,
        });

        clearDomSelection();
        usePlayerStore.getState().setSelectedElementId(null);
        setRefreshKey((k) => k + 1);
        showToast(`Deleted ${label}. Use Undo to restore it.`, "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to delete element";
        showToast(message);
      }
    },
    [
      activeCompPath,
      clearDomSelection,
      domEditSaveTimestampRef,
      editHistory.recordEdit,
      projectIdRef,
      setRefreshKey,
      showToast,
      writeProjectFile,
    ],
  );

  return {
    // State
    domEditSelection,
    domEditGroupSelections,
    domEditHoverSelection,
    agentModalOpen,
    agentModalAnchorPoint,
    copiedAgentPrompt,
    agentPromptSelectionContext,

    // Refs
    domEditSelectionRef,

    // Callbacks
    handleTimelineElementSelect,
    handlePreviewCanvasMouseDown,
    handlePreviewCanvasPointerMove,
    handlePreviewCanvasPointerLeave,
    applyDomSelection,
    clearDomSelection,
    handleDomStyleCommit,
    handleDomPathOffsetCommit,
    handleDomGroupPathOffsetCommit,
    handleDomBoxSizeCommit,
    handleDomRotationCommit,
    handleDomManualEditsReset,
    handleDomMotionCommit,
    handleDomMotionClear,
    handleDomTextCommit,
    handleDomTextFieldStyleCommit,
    handleDomAddTextField,
    handleDomRemoveTextField,
    handleAskAgent,
    handleAgentModalSubmit,
    handleBlockedDomMove,
    handleDomManualDragStart,
    handleDomEditElementDelete,
    buildDomSelectionForTimelineElement,
    resolveImportedFontAsset,
    setAgentModalOpen,
    setAgentPromptSelectionContext,
    setAgentModalAnchorPoint,
  };
}
