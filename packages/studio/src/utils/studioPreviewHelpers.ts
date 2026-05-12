import type { DomEditViewport, DomEditSelection } from "../components/editor/domEditing";
import { resolveVisualDomEditSelectionTarget } from "../components/editor/domEditing";
import { usePlayerStore, liveTime } from "../player";
import { getEventTargetElement } from "./studioHelpers";

export interface PreviewLocalPointer {
  x: number;
  y: number;
  viewport: DomEditViewport;
}

export interface PreviewPlayerCompat {
  getTime: () => number;
  renderSeek: (timeSeconds: number) => void;
}

export function resolvePreviewLocalPointer(
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

export function getPreviewLocalPointer(
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

export function getPreviewTargetFromPointer(
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

  return getEventTargetElement(doc.elementFromPoint(localPointer.x, localPointer.y));
}

export function buildRasterClickSelectionContext(
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

export function getPreviewPlayer(win: Window | null | undefined): PreviewPlayerCompat | null {
  const player = objectLike(win ? Reflect.get(win, "__player") : null);
  if (!player) return null;
  const getTime = Reflect.get(player, "getTime");
  const renderSeek = Reflect.get(player, "renderSeek");
  if (typeof getTime !== "function" || typeof renderSeek !== "function") return null;
  return {
    getTime: () => {
      const value = getTime.call(player);
      return typeof value === "number" && Number.isFinite(value) ? value : 0;
    },
    renderSeek: (timeSeconds: number) => {
      renderSeek.call(player, timeSeconds);
    },
  };
}

export function seekStudioPreview(iframe: HTMLIFrameElement | null, timeSeconds: number): boolean {
  const player = getPreviewPlayer(iframe?.contentWindow);
  if (!player) return false;
  const nextTime = Math.max(0, timeSeconds);
  player.renderSeek(nextTime);
  usePlayerStore.getState().setCurrentTime(nextTime);
  liveTime.notify(nextTime);
  return true;
}

export function pauseStudioPreviewPlayback(iframe: HTMLIFrameElement | null): number | null {
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
