import { applyAuthoredTiming, RUNTIME_STAMPED_ATTR } from "@hyperframes/core/studio-preview-mark";
import { type TimelineElement, usePlayerStore } from "../player/store/playerStore";
import { formatTimelineAttributeNumber } from "../player/components/timelineEditing";
import { furthestClipEndFromDocument } from "../player/lib/timelineElementHelpers";
import { previewDocumentCopy, previewFrameOpaque } from "../player/lib/previewChannel";
import { editPreviewElement, queryPreviewElements } from "../player/lib/previewElements";
import {
  findPreviewElementForSelection,
  findPreviewElementForTimelineElement,
} from "../components/editor/previewSelection";
import { patchDocumentRootDuration } from "./timelineEditingGsap";
import { findTimelineElementInIframe } from "./timelineEditingHelpers";

const sealedWrites = new WeakMap<HTMLIFrameElement, Promise<unknown>>();

/** A sealed frame's timing writes and reads run one after another, in the order the edit made them. */
function inOrder(iframe: HTMLIFrameElement, step: () => Promise<unknown>): void {
  const next = (sealedWrites.get(iframe) ?? Promise.resolve()).then(step).catch(() => undefined);
  sealedWrites.set(iframe, next);
}

export function patchIframeDomTiming(
  iframe: HTMLIFrameElement | null,
  element: TimelineElement,
  attrs: Array<[string, string]>,
  activeCompositionPath: string | null = null,
): void {
  if (iframe && previewFrameOpaque(iframe)) {
    inOrder(iframe, () => patchSealedTiming(iframe, element, attrs, activeCompositionPath));
    return;
  }
  try {
    const el = findTimelineElementInIframe(iframe, element, activeCompositionPath);
    if (!el) return;
    applyAuthoredTiming(el, attrs);
  } catch {
    // Cross-origin or mid-navigation — file save is enqueued; iframe patch is best-effort.
  }
}

async function patchSealedTiming(
  iframe: HTMLIFrameElement,
  element: TimelineElement,
  attrs: Array<[string, string]>,
  activeCompositionPath: string | null,
): Promise<void> {
  const found =
    element.kind === "composition" && element.compositionSrc
      ? await findPreviewElementForTimelineElement(iframe, element, {
          activeCompositionPath,
          isMasterView: true,
        })
      : await findPreviewElementForSelection(
          iframe,
          {
            hfId: element.hfId,
            id: element.domId,
            selector: element.selector,
            selectorIndex: element.selectorIndex,
            sourceFile: element.sourceFile || activeCompositionPath || "index.html",
          },
          activeCompositionPath,
        );
  if (!found) return;
  const attributes: Array<[string, string | null]> = [...attrs, [RUNTIME_STAMPED_ATTR, null]];
  await editPreviewElement(iframe, found.handle, { attributes }).drawn;
}

function patchIframeRootDuration(iframe: HTMLIFrameElement | null, contentEnd: number): void {
  if (iframe && previewFrameOpaque(iframe)) {
    inOrder(iframe, async () =>
      patchSealedRootDuration(iframe, await previewDocumentCopy(iframe), contentEnd),
    );
    return;
  }
  try {
    patchDocumentRootDuration(iframe?.contentDocument ?? null, contentEnd);
  } catch {
    // Cross-origin or mid-navigation — file save is enqueued; iframe patch is best-effort.
  }
}

/** `patchDocumentRootDuration` on the frame, its root found in `copy` and matched by document order. */
async function patchSealedRootDuration(
  iframe: HTMLIFrameElement,
  copy: Document | null,
  contentEnd: number,
): Promise<void> {
  if (!copy || !Number.isFinite(contentEnd) || contentEnd <= 0) return;
  const nodes = Array.from(copy.querySelectorAll("[data-composition-id]"));
  const root =
    nodes.find((node) => !node.parentElement?.closest("[data-composition-id]")) ?? nodes[0];
  const handle =
    root &&
    (await queryPreviewElements(iframe, "[data-composition-id]"))?.matches[nodes.indexOf(root)]
      ?.handle;
  if (!handle) return;
  const duration = formatTimelineAttributeNumber(contentEnd);
  await editPreviewElement(iframe, handle, { attributes: [["data-duration", duration]] }).drawn;
}

function syncContentDuration(
  iframe: HTMLIFrameElement | null,
  doc: Document | null,
): Promise<void> {
  const end = furthestClipEndFromDocument(doc);
  if (end <= 0) return Promise.resolve();
  usePlayerStore.getState().setDuration(end);
  if (iframe && previewFrameOpaque(iframe)) return patchSealedRootDuration(iframe, doc, end);
  patchIframeRootDuration(iframe, end);
  return Promise.resolve();
}

/** Keep the duration readout and live root aligned with optimistically patched clips. */
export function syncPreviewContentDuration(iframe: HTMLIFrameElement | null): void {
  if (iframe && previewFrameOpaque(iframe)) {
    inOrder(iframe, async () => syncContentDuration(iframe, await previewDocumentCopy(iframe)));
    return;
  }
  void syncContentDuration(iframe, iframe?.contentDocument ?? null);
}

/** Restore both store and live-root duration when a timing persist fails. */
export function captureDurationRollback(iframe: HTMLIFrameElement | null): () => void {
  const previousDuration = usePlayerStore.getState().duration;
  const rollback = () => {
    if (usePlayerStore.getState().duration === previousDuration) return;
    usePlayerStore.getState().setDuration(previousDuration);
    patchIframeRootDuration(iframe, previousDuration);
  };
  return () => {
    if (iframe && previewFrameOpaque(iframe)) inOrder(iframe, async () => rollback());
    else rollback();
  };
}
