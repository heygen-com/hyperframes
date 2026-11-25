import { isWebKit } from "./runtime/mediaClock.js";

export {
  TRANSITION_LABEL_PREFIX,
  transitionLabelsForDocument,
} from "./runtime/transitionLabels.js";

export const STUDIO_PREVIEW_MARK_META = "hyperframes-studio-preview";
export const PREVIEW_SEEK_HOLD_ATTR = "data-hf-preview-seek-hold";
export const PREVIEW_VIDEO_FRAME_ATTR = "data-hf-preview-video-frame";
export const PREVIEW_VIDEO_SOURCE_ATTR = "data-hf-preview-video-source";
export const PREVIEW_VIDEO_CANVAS_ATTR = "data-hf-preview-video-canvas";
export const STUDIO_PREVIEW_CAPTURE_MODE = "capture";
export const PREVIEW_FOR_ANOTHER_SITE_META = "hyperframes-preview-for-another-site";

export function servedToAnotherSite(doc: Document): boolean {
  return doc.querySelector(`meta[name="${PREVIEW_FOR_ANOTHER_SITE_META}"]`) !== null;
}

export function markedForStudio(doc: Document): boolean {
  return (
    doc.querySelector(`meta[name="${STUDIO_PREVIEW_MARK_META}"]`) !== null &&
    !servedToAnotherSite(doc)
  );
}

export function getLogicalOpacity(el: Element, computed: CSSStyleDeclaration): string {
  const overlay = el.previousElementSibling;
  if (
    el.hasAttribute(PREVIEW_VIDEO_FRAME_ATTR) &&
    overlay?.localName === "canvas" &&
    overlay.hasAttribute(PREVIEW_VIDEO_CANVAS_ATTR)
  )
    return el.ownerDocument.defaultView?.getComputedStyle(overlay).opacity ?? computed.opacity;
  return computed.opacity;
}
export const PLAYER_FRAME_ATTR = "data-hf-player-frame";
export const PLAYER_FRAME_NAME = "hyperframes-player";

export function servedToStudio(doc: Document): boolean {
  return doc.querySelector(`meta[name="${STUDIO_PREVIEW_MARK_META}"]`) !== null;
}

export function inPlayerFrame(doc: Document): boolean {
  const frame = doc.defaultView;
  const marked = frame?.frameElement?.hasAttribute(PLAYER_FRAME_ATTR) === true;
  if (servedToStudio(doc)) return isWebKit() && marked;
  return marked || frame?.name === PLAYER_FRAME_NAME;
}

export function defersMediaIn(doc: Document): boolean {
  return servedToStudio(doc) || inPlayerFrame(doc);
}
export function capturePageIn(doc: Document): boolean {
  return (
    doc.querySelector(`meta[name="${STUDIO_PREVIEW_MARK_META}"]`)?.getAttribute("content") ===
    STUDIO_PREVIEW_CAPTURE_MODE
  );
}
export const CAPTURE_STILLS = "hf-capture-stills";
export const CAPTURE_STILL_ATTR = "data-hf-capture-still";
export function captureStillsIn(doc: Document): boolean {
  return capturePageIn(doc) && doc.querySelector(`meta[name="${CAPTURE_STILLS}"]`) !== null;
}
export const STUDIO_PREVIEW_UPCOMING_ATTR = "data-hf-upcoming";
export const STUDIO_PREVIEW_LAZY_ATTR = "data-hf-preview-lazy";
export const STUDIO_PREVIEW_ERRORS = "__hfPreviewErrors";
export const STUDIO_PREVIEW_ERROR_MESSAGE = "preview-error";
export const STUDIO_PREVIEW_ERROR_KINDS = "__hfPreviewErrorKinds";
export function previewConsoleErrorText(args: readonly unknown[]): string | null {
  const text = args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ");
  return text.includes("favicon") ? null : text;
}

export const refusedPreviewMessage = (status: number) =>
  `The preview page could not be loaded (HTTP ${status}).`;
export function refusedPreviewStatus(message: string): number | null {
  const status = /^The preview page could not be loaded \(HTTP (\d{3})\)\.$/.exec(message)?.[1];
  return status ? Number(status) : null;
}
export const PREVIEW_RASTER_ATTR = "data-hf-preview-raster";
export const RUNTIME_STAMPED_ATTR = "data-hf-autostamped";
export const CLIP_HIDDEN_ATTR = "data-hf-clip-hidden";
export const STUDIO_PREVIEW_FAR_SCENE_ATTR = "data-hf-far-scene";
export const STUDIO_PREVIEW_PARKED_SCENE_ATTR = "data-hf-parked-scene";
export const PREVIEW_FILE_SIZE_ATTR = "data-hf-file-size";
export const PREVIEW_ONLY_ATTRS = [
  PREVIEW_VIDEO_FRAME_ATTR,
  PREVIEW_VIDEO_SOURCE_ATTR,
  PREVIEW_VIDEO_CANVAS_ATTR,
  STUDIO_PREVIEW_UPCOMING_ATTR,
  STUDIO_PREVIEW_FAR_SCENE_ATTR,
  STUDIO_PREVIEW_PARKED_SCENE_ATTR,
  STUDIO_PREVIEW_LAZY_ATTR,
  PREVIEW_RASTER_ATTR,
  RUNTIME_STAMPED_ATTR,
  PREVIEW_FILE_SIZE_ATTR,
] as const;

export const isClipHiddenByRuntime = (el: HTMLElement) =>
  el.hasAttribute(CLIP_HIDDEN_ATTR) && el.style.visibility === "hidden";

export function applyAuthoredTiming(
  el: Element,
  attrs: ReadonlyArray<readonly [name: string, value: string]>,
): void {
  for (const [name, value] of attrs) el.setAttribute(name, value);
  el.removeAttribute(RUNTIME_STAMPED_ATTR);
}

export function dropServiceWorkers(): Promise<void> {
  const workers = typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
  if (!workers) return Promise.resolve();
  return workers
    .getRegistrations()
    .then((all) => Promise.all(all.map((each) => each.unregister())))
    .then(
      () => undefined,
      () => undefined,
    );
}

export function serviceWorkerScriptFetch(headers: {
  serviceWorker?: string | string[];
  fetchDest?: string | string[];
}): boolean {
  return headers.serviceWorker === "script" || headers.fetchDest === "serviceworker";
}

export interface PreviewTarget {
  hfId?: string;
  domId?: string;
  id: string;
  sourceFile?: string;
}

export function previewElementSourceFile(el: Element): string | undefined {
  const ownerRoot = el.parentElement?.closest("[data-composition-id]");
  return (
    ownerRoot?.getAttribute("data-composition-file") ??
    ownerRoot?.getAttribute("data-composition-src") ??
    undefined
  );
}

export function previewElementFinder(
  doc: Document,
  selector = "[data-hf-id], [id]",
): (target: PreviewTarget) => Element | null {
  const byKey = new Map<string, Element[]>();
  const add = (key: string, node: Element) => {
    const nodes = byKey.get(key);
    if (nodes) nodes.push(node);
    else byKey.set(key, [node]);
  };
  for (const node of doc.querySelectorAll(selector)) {
    const hfId = node.getAttribute("data-hf-id");
    const id = node.getAttribute("id");
    if (hfId) add(`hf:${hfId}`, node);
    if (id) add(`id:${id}`, node);
  }
  return (target) => {
    const matches = [
      ...((target.hfId && byKey.get(`hf:${target.hfId}`)) || []),
      ...(byKey.get(`id:${target.domId ?? target.id}`) ?? []),
    ];
    return (
      matches.find((node) => previewElementSourceFile(node) === target.sourceFile) ??
      matches[0] ??
      null
    );
  };
}
