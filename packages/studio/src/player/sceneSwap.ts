import { studioApiFetch } from "../utils/studioApiFetch";
import { studioFileRevision } from "../utils/studioFileVersion";
import { logReload } from "../utils/reloadDebug";
import { afterStudioPendingEdits } from "../utils/studioPendingEdits";
import { whileScriptWrites } from "./previewReloading";
import { markScenesStaleIn } from "@hyperframes/core/runtime/scenes";
import { previewFrameOpaque, previewRequest } from "./lib/previewChannel";

type ApplySwap = (html: string, signal: AbortSignal) => Promise<void>;
type SwapWindow = Window & {
  __hfSwapScenes?: (html: string, signal?: AbortSignal) => Promise<void>;
};

const SCENES_SWAPPED = "hf-scenes-swapped";
export const SCENE_SWAP_MS = 5000;

const PREVIEW_DOCUMENT_LOADED = "hf-preview-document-loaded";

export function announcePreviewDocumentLoaded(iframe: HTMLIFrameElement): void {
  iframe.dispatchEvent(new Event(PREVIEW_DOCUMENT_LOADED));
}

export function onPreviewDocumentLoaded(
  iframe: HTMLIFrameElement,
  onLoaded: () => void,
): () => void {
  iframe.addEventListener(PREVIEW_DOCUMENT_LOADED, onLoaded);
  return () => iframe.removeEventListener(PREVIEW_DOCUMENT_LOADED, onLoaded);
}

const RESTORED_IN_PLACE = "hf-preview-restored-in-place";

export function announcePreviewRestoredInPlace(iframe: HTMLIFrameElement): void {
  const announce = () => iframe.dispatchEvent(new Event(RESTORED_IN_PLACE));
  queueMicrotask(() => afterStudioPendingEdits(announce));
}

export function onPreviewRestoredInPlace(iframe: HTMLIFrameElement, onRestored: () => void) {
  iframe.addEventListener(RESTORED_IN_PLACE, onRestored);
  return () => iframe.removeEventListener(RESTORED_IN_PLACE, onRestored);
}

export function onPreviewContentReplaced(
  iframe: HTMLIFrameElement,
  onReplaced: () => void,
): () => void {
  const stopLoaded = onPreviewDocumentLoaded(iframe, onReplaced);
  iframe.addEventListener(SCENES_SWAPPED, onReplaced);
  return () => {
    stopLoaded();
    iframe.removeEventListener(SCENES_SWAPPED, onReplaced);
  };
}

const PREVIEW_PROMOTED = "hf-preview-promoted";
export type PreviewPromotion = { retired: HTMLIFrameElement | null; live: HTMLIFrameElement };

export function announcePreviewPromoted(promotion: PreviewPromotion): void {
  promotion.live.ownerDocument.dispatchEvent(
    new CustomEvent(PREVIEW_PROMOTED, { detail: promotion }),
  );
}

export function onPreviewPromoted(
  doc: Document,
  listener: (promotion: PreviewPromotion) => void,
): () => void {
  const handle = (event: Event) => listener((event as CustomEvent<PreviewPromotion>).detail);
  doc.addEventListener(PREVIEW_PROMOTED, handle);
  return () => doc.removeEventListener(PREVIEW_PROMOTED, handle);
}

export function markScenesStale(iframe: HTMLIFrameElement | null, files: readonly string[]): void {
  if (iframe && previewFrameOpaque(iframe)) {
    void previewRequest(iframe, "mark-scenes-stale", { files: [...files] });
    return;
  }
  const doc = iframe?.contentDocument;
  if (doc) markScenesStaleIn(doc, files);
}

export const supersededByNewerEdit = () =>
  new DOMException("superseded by a newer edit", "AbortError");

const SWAP_REFETCHES_BEFORE_THE_COPY_IN_HAND_WINS = 5;

type SceneSwap = (url: string, isCurrent: () => boolean, cancel?: AbortSignal) => Promise<void>;

export function swapFreshly(
  swap: SceneSwap,
  url: URL,
  isCurrent: () => boolean,
  cancel: AbortSignal,
  reloadWholeFilm: (url: string) => void,
  attempt = 0,
): void {
  const at = studioFileRevision();
  const fresh = () => studioFileRevision() === at;
  const again = () => {
    url.searchParams.set("_t", String(Date.now()));
    swapFreshly(swap, url, isCurrent, cancel, reloadWholeFilm, attempt + 1);
  };
  const retries = attempt < SWAP_REFETCHES_BEFORE_THE_COPY_IN_HAND_WINS;
  const gate = retries ? () => isCurrent() && fresh() : isCurrent;
  whileScriptWrites(() => swap(url.toString(), gate, cancel))
    .then(() => {
      if (isCurrent() && !fresh() && retries) again();
    })
    .catch((error: unknown) => {
      if (!isCurrent()) return;
      if (!fresh() && retries) return again();
      logReload("scene-swap-refused", { reason: String(error) });
      reloadWholeFilm(url.toString());
    });
}

function reachableSwap(iframe: HTMLIFrameElement): ApplySwap | null {
  const win = iframe.contentWindow as SwapWindow | null;
  const swap = win?.__hfSwapScenes;
  return typeof swap === "function" ? (html, signal) => swap.call(win, html, signal) : null;
}

function sealedSwap(iframe: HTMLIFrameElement): ApplySwap {
  return async (html) => {
    const reply: unknown = await previewRequest(
      iframe,
      "swap-scenes",
      { html, timeoutMs: SCENE_SWAP_MS },
      SCENE_SWAP_MS,
    );
    const { swapped, reason } = (reply ?? {}) as { swapped?: unknown; reason?: unknown };
    if (swapped === true && Object.keys(reply as object).length === 1) return;
    const why = typeof reason === "string" ? reason.slice(0, 500) : "no answer";
    throw new Error(`the preview did not swap its scenes: ${why}`);
  };
}

/** Null when the preview cannot swap; rejects when superseded, cancelled or a full reload is needed. */
export function sceneSwapFor(
  iframe: HTMLIFrameElement,
): ((url: string, isCurrent: () => boolean, cancel?: AbortSignal) => Promise<void>) | null {
  const apply = previewFrameOpaque(iframe) ? sealedSwap(iframe) : reachableSwap(iframe);
  if (!apply) return null;
  return async (url, isCurrent, cancel) => {
    if (cancel?.aborted) throw cancel.reason;
    const deadline = new AbortController();
    const timer = setTimeout(
      () => deadline.abort(new Error("the preview took too long to swap")),
      SCENE_SWAP_MS,
    );
    const onCancel = () => deadline.abort(cancel?.reason);
    cancel?.addEventListener("abort", onCancel, { once: true });
    const swapping = (async () => {
      const response = await studioApiFetch(url, { signal: deadline.signal });
      if (!response.ok) throw new Error(`preview request failed with ${response.status}`);
      const html = await response.text();
      if (!isCurrent()) throw new Error("superseded by a newer reload");
      // Aborted with the deadline, so a swap still waiting cannot land after the reload has begun.
      await apply(html, deadline.signal);
    })();
    const expired = new Promise<never>((_resolve, reject) =>
      deadline.signal.addEventListener("abort", () => reject(deadline.signal.reason)),
    );
    try {
      await Promise.race([swapping, expired]);
    } finally {
      clearTimeout(timer);
      cancel?.removeEventListener("abort", onCancel);
    }
    iframe.dispatchEvent(new Event(SCENES_SWAPPED));
  };
}
