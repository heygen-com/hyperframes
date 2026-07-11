import type { TimelineElement } from "../player/store/playerStore";
import type { DomEditSelection } from "../components/editor/domEditing";
import type { TimelineAssetKind } from "./timelineAssetDrop";
import { roundToCenti } from "./rounding";

export interface EditingFile {
  path: string;
  content: string | null;
}

export interface AppToast {
  message: string;
  tone: "error" | "info";
}

export type RightPanelTab =
  | "layers"
  | "design"
  | "renders"
  | "block-params"
  | "slideshow"
  | "variables";
export type RightInspectorPane = "layers" | "design";

export interface RightInspectorPanes {
  layers: boolean;
  design: boolean;
}

export interface AgentModalAnchorPoint {
  x: number;
  y: number;
}

export function getTimelineElementLabel(element: TimelineElement): string {
  return element.label || element.id || element.tag;
}

function normalizeProjectAssetPath(value: string): string {
  const trimmed = value.trim();
  const maybeUrl = /^[a-z]+:\/\//i.test(trimmed) ? new URL(trimmed).pathname : trimmed;
  return decodeURIComponent(maybeUrl)
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "");
}

export function toRelativeProjectAssetPath(sourceFile: string, assetPath: string): string {
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

export function toProjectAbsolutePath(
  projectDir: string | null,
  sourceFile: string,
): string | undefined {
  const trimmedSource = sourceFile.trim();
  if (!trimmedSource) return undefined;

  const normalizedSource = trimmedSource.replace(/\\/g, "/");
  if (isAbsoluteFilePath(normalizedSource)) return normalizedSource;

  const normalizedRoot = projectDir?.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalizedRoot) return undefined;

  return `${normalizedRoot}/${normalizedSource.replace(/^\.?\//, "")}`;
}

export function normalizeDomEditStyleValue(property: string, value: string): string {
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

export function isImageBackgroundValue(value: string): boolean {
  return /^url\(/i.test(value.trim());
}

export function isManualGeometryStyleProperty(property: string): boolean {
  return property === "left" || property === "top" || property === "width" || property === "height";
}

export function getEventTargetElement(target: EventTarget | null): HTMLElement | null {
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

export function shouldIgnoreHistoryShortcut(target: EventTarget | null): boolean {
  const el = getEventTargetElement(target);
  if (!el) return false;
  return Boolean(
    el.closest("input, textarea, select, [contenteditable='true'], [role='textbox'], .cm-editor"),
  );
}

export function getHistoryShortcutLabel(action: "undo" | "redo"): string {
  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
  const modifier = isMac ? "Cmd" : "Ctrl";
  return action === "undo" ? `${modifier}+Z` : `${modifier}+Shift+Z`;
}

type ElementMatchSelection = Pick<
  DomEditSelection,
  "id" | "selector" | "selectorIndex" | "sourceFile" | "compositionSrc" | "isCompositionHost"
>;

function matchesByDomId(
  selection: ElementMatchSelection,
  element: TimelineElement,
  selectionSourceFile: string,
): boolean {
  if (!selection.id) return false;
  return (
    element.domId === selection.id && (element.sourceFile || "index.html") === selectionSourceFile
  );
}

function matchesByCompositionHost(
  selection: ElementMatchSelection,
  element: TimelineElement,
): boolean {
  if (!selection.isCompositionHost || !selection.compositionSrc) return false;
  return element.compositionSrc === selection.compositionSrc;
}

function matchesBySelector(selection: ElementMatchSelection, element: TimelineElement): boolean {
  if (!selection.selector) return false;
  return (
    element.selector === selection.selector &&
    (element.selectorIndex ?? 0) === (selection.selectorIndex ?? 0) &&
    (element.sourceFile ?? "index.html") === selection.sourceFile
  );
}

function elementMatchesSelection(
  selection: ElementMatchSelection,
  element: TimelineElement,
  selectionSourceFile: string,
): boolean {
  return (
    matchesByDomId(selection, element, selectionSourceFile) ||
    matchesByCompositionHost(selection, element) ||
    matchesBySelector(selection, element)
  );
}

export function findMatchingTimelineElementId(
  selection: ElementMatchSelection,
  elements: TimelineElement[],
): string | null {
  const selectionSourceFile = selection.sourceFile || "index.html";
  const match = elements.find((el) => elementMatchesSelection(selection, el, selectionSourceFile));
  if (match) return match.key ?? match.id;

  // Child inside a sub-composition: return a qualified ID so the expansion
  // hook can resolve the child via clipParentMap even though no timeline
  // element exists for it yet (the expansion creates it on the fly).
  if (selection.id && selectionSourceFile !== "index.html") {
    return `${selectionSourceFile}#${selection.id}`;
  }

  return null;
}

/**
 * A selected DOM node may be a static descendant of a clip (e.g. the `.num` text
 * inside a `#stat1` card) — not a timeline element itself. Walk up to the nearest
 * ancestor that IS a clip so the timeline still selects + inline-expands around it.
 */
export function findTimelineIdByAncestor(
  element: Element | null | undefined,
  elements: TimelineElement[],
  sourceFile: string,
): string | null {
  let ancestor = element?.parentElement ?? null;
  while (ancestor) {
    const id = ancestor.id;
    if (id) {
      const match = elements.find(
        (el) => el.domId === id && (el.sourceFile ?? "index.html") === sourceFile,
      );
      if (match) return match.key ?? match.id;
    }
    ancestor = ancestor.parentElement;
  }
  return null;
}

/**
 * Resolve the timeline element id for a DOM selection: direct match first, then
 * nearest clip ancestor. The ancestor lookup resolves against the selection's own
 * source file, falling back to the active composition path, then index.html — so a
 * sub-composition selection with no explicit sourceFile resolves against the comp
 * currently open, not always the root file.
 */
export function resolveTimelineIdForSelection(
  selection: DomEditSelection,
  elements: TimelineElement[],
  activeCompPath: string | null,
): string | null {
  return (
    findMatchingTimelineElementId(selection, elements) ??
    findTimelineIdByAncestor(
      selection.element,
      elements,
      selection.sourceFile || activeCompPath || "index.html",
    )
  );
}

/**
 * Resolve every multi-selected element to its scope-qualified timeline key
 * (dropping unresolvable ones). Selections carry bare DOM ids/selectors, but
 * the visibility toggle matches keys like "index.html#hero" — and callers must
 * hide all keys in ONE call so the file is patched in a single atomic write
 * (per-element calls would clobber each other's reads).
 */
export function timelineKeysForSelections(
  selections: readonly DomEditSelection[],
  elements: TimelineElement[],
  activeCompPath: string | null,
): string[] {
  return selections
    .map((selection) => resolveTimelineIdForSelection(selection, elements, activeCompPath))
    .filter((key): key is string => key !== null);
}

export type ToggleHiddenHandler = (
  elementKey: string | readonly string[],
  hidden: boolean,
) => Promise<void> | void;

export function resolveTimelineSelectionSeekTime(
  currentTime: number,
  element: Pick<TimelineElement, "start" | "duration"> | null | undefined,
): number | null {
  if (!element) return null;
  if (!Number.isFinite(element.start) || !Number.isFinite(element.duration)) return null;

  const start = Math.max(0, element.start);
  const end = Math.max(start, start + Math.max(0, element.duration));
  const time = Number.isFinite(currentTime) ? currentTime : start;

  return clampNumber(time, start, end);
}

export function clampNumber(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

// fallow-ignore-next-line unused-export
export { COMPOSITION_ROOT_OPEN_TAG_RE } from "./compositionPatterns";

export function collectHtmlIds(source: string): string[] {
  return Array.from(source.matchAll(/\bid="([^"]+)"/g), (match) => match[1] ?? "");
}

const DEFAULT_TIMELINE_ASSET_DURATION: Record<TimelineAssetKind, number> = {
  image: 3,
  video: 5,
  audio: 5,
};

export async function resolveDroppedAssetDuration(
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
            ? roundToCenti(raw)
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

export async function resolveDroppedAssetDimensions(
  projectId: string,
  assetPath: string,
  kind: TimelineAssetKind,
): Promise<{ width: number; height: number } | null> {
  if (kind === "audio") return null;
  const src = `/api/projects/${projectId}/preview/${assetPath}`;

  if (kind === "image") {
    return new Promise((resolve) => {
      const img = new Image();
      const timeout = window.setTimeout(() => resolve(null), 3000);
      img.addEventListener(
        "load",
        () => {
          window.clearTimeout(timeout);
          resolve(
            img.naturalWidth > 0 && img.naturalHeight > 0
              ? { width: img.naturalWidth, height: img.naturalHeight }
              : null,
          );
        },
        { once: true },
      );
      img.addEventListener(
        "error",
        () => {
          window.clearTimeout(timeout);
          resolve(null);
        },
        { once: true },
      );
      img.src = src;
    });
  }

  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    const timeout = window.setTimeout(() => resolve(null), 3000);
    const finalize = (value: { width: number; height: number } | null) => {
      window.clearTimeout(timeout);
      video.src = "";
      video.load();
      resolve(value);
    };
    video.addEventListener(
      "loadedmetadata",
      () => {
        finalize(
          video.videoWidth > 0 && video.videoHeight > 0
            ? { width: video.videoWidth, height: video.videoHeight }
            : null,
        );
      },
      { once: true },
    );
    video.addEventListener("error", () => finalize(null), { once: true });
    video.src = src;
  });
}
