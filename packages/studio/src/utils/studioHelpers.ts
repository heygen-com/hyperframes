import type { TimelineElement } from "../player";
import type { DomEditSelection } from "../components/editor/domEditing";
import type { TimelineAssetKind } from "./timelineAssetDrop";

export interface EditingFile {
  path: string;
  content: string | null;
}

export interface AppToast {
  message: string;
  tone: "error" | "info";
}

export type RightPanelTab = "design" | "motion" | "renders";

export interface AgentModalAnchorPoint {
  x: number;
  y: number;
}

export function getTimelineElementLabel(element: TimelineElement): string {
  return element.label || element.id || element.tag;
}

export function confirmElementDelete(label: string, kind: "timeline clip" | "element"): boolean {
  return window.confirm(
    `Delete ${kind} "${label}"?\n\nThis removes it from the project source. You can use Undo to restore it.`,
  );
}

export function normalizeProjectAssetPath(value: string): string {
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

export function isAbsoluteFilePath(value: string): boolean {
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

export function findMatchingTimelineElementId(
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

export function clampNumber(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export function collectHtmlIds(source: string): string[] {
  return Array.from(source.matchAll(/\bid="([^"]+)"/g), (match) => match[1] ?? "");
}

export const DEFAULT_TIMELINE_ASSET_DURATION: Record<TimelineAssetKind, number> = {
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
