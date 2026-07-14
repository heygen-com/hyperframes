// Soft-apply of undo/redo restores to the live preview: diff a restored file
// against the live one, sync attribute-only changes onto the live DOM, and
// re-run the restored GSAP script via applySoftReload — avoiding the full
// iframe remount (black flash + WebGL context loss) whenever the restore is
// expressible in place.
import { applySoftReload, extractGsapScriptText, findGsapScriptElements } from "./gsapSoftReload";

type PreviewWindow = Window & {
  __player?: { seek?: (t: number) => void };
  __hfStudioManualEditsApply?: () => void;
};

/** One file's restore from the edit-history store: before (live) / after (target) bytes. */
export interface UndoRestoreFile {
  previous: string;
  restored: string;
}

function idElementMap(doc: Document): Map<string, Element> {
  const map = new Map<string, Element>();
  for (const el of doc.querySelectorAll("[id]")) {
    const id = el.getAttribute("id");
    if (id) map.set(id, el);
  }
  return map;
}

// Strip id'd elements to bare `id` and blank GSAP scripts, in place: docs that
// differ only in id'd attributes/inline-style/script text normalize equal; any
// residual difference is beyond soft-reload's reach → caller full-reloads.
function normalizeSoftResidual(doc: Document): void {
  for (const el of doc.querySelectorAll("[id]")) {
    const id = el.getAttribute("id");
    for (const name of [...el.getAttributeNames()]) {
      if (name !== "id") el.removeAttribute(name);
    }
    if (id) el.setAttribute("id", id);
  }
  for (const script of findGsapScriptElements(doc)) script.textContent = "";
}

// Soft-reloadable iff the docs differ SOLELY in id'd-element attributes/inline
// style and/or the GSAP script; returns the changed ids to sync onto the live
// DOM. Structural/text diffs → null → the caller full-reloads. Pure.
export function diffSoftReloadableRestore(
  previous: string,
  restored: string,
): { changedElementIds: string[] } | null {
  let prevDoc: Document;
  let nextDoc: Document;
  try {
    prevDoc = new DOMParser().parseFromString(previous, "text/html");
    nextDoc = new DOMParser().parseFromString(restored, "text/html");
  } catch {
    return null;
  }
  const prevById = idElementMap(prevDoc);
  const nextById = idElementMap(nextDoc);
  // A different id set means an element was added or removed (e.g. a split, a
  // delete) — structural, so soft-reload can't express it.
  if (prevById.size !== nextById.size) return null;
  const changedElementIds: string[] = [];
  for (const [id, nextEl] of nextById) {
    const prevEl = prevById.get(id);
    if (!prevEl || prevEl.tagName !== nextEl.tagName) return null;
    // A change inside the element (text / children) is out of soft scope; only
    // its own attributes may differ. (GSAP scripts are handled via re-run.)
    if (prevEl.innerHTML !== nextEl.innerHTML) return null;
    if (prevEl.outerHTML !== nextEl.outerHTML) changedElementIds.push(id);
  }
  // Confirm nothing OUTSIDE id'd-element attributes and GSAP scripts changed.
  normalizeSoftResidual(prevDoc);
  normalizeSoftResidual(nextDoc);
  if (prevDoc.documentElement.outerHTML !== nextDoc.documentElement.outerHTML) return null;
  return { changedElementIds };
}

/** Copy every attribute from `source` onto the live `target`, dropping extras. */
function syncElementAttributes(target: Element, source: Element): void {
  for (const name of [...target.getAttributeNames()]) {
    if (!source.hasAttribute(name)) target.removeAttribute(name);
  }
  for (const name of source.getAttributeNames()) {
    target.setAttribute(name, source.getAttribute(name) ?? "");
  }
}

/**
 * Soft-apply an undo/redo restore to the live preview WITHOUT a full iframe
 * remount (which blanks the frame black and re-flashes the WebGL context). Only
 * the active composition — the document living in the root iframe — is eligible;
 * a sub-comp or multi-file restore falls back to `reloadPreview`.
 *
 * The restore is soft-applied when its only differences are id'd-element
 * attributes / inline-style and/or the GSAP script (see diffSoftReloadableRestore):
 *   1. Each changed element's attribute surface (inline style, data-start /
 *      -duration, the studio manual-offset props + flags) is synced onto the live
 *      element — so a canvas-position revert lands on the live DOM the runtime's
 *      seek-reapply reads from, not just on disk.
 *   2. The restored GSAP script is re-run in place via applySoftReload, which
 *      re-seeks to `currentTime` (playhead-invariant) and re-folds manual edits.
 *      With no single script, the manual-edit reapply is invoked directly.
 *
 * Returns "soft" when applied in place, "full" when it escalated to reloadPreview
 * (ineligible restore, missing target, or a permanent soft-reload failure).
 */
export function applyUndoRestoreToPreview(
  iframe: HTMLIFrameElement | null,
  activeCompPath: string | null,
  files: Record<string, UndoRestoreFile> | undefined,
  currentTime: number,
  reloadPreview: () => void,
): "soft" | "full" {
  const paths = files ? Object.keys(files) : [];
  // Soft path only covers the single active-comp document in the root iframe.
  if (!iframe || !activeCompPath || !files || paths.length !== 1 || paths[0] !== activeCompPath) {
    reloadPreview();
    return "full";
  }
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow as PreviewWindow | null;
  if (!doc || !win) {
    reloadPreview();
    return "full";
  }
  const { previous, restored } = files[activeCompPath]!;
  const diff = diffSoftReloadableRestore(previous, restored);
  if (!diff) {
    reloadPreview();
    return "full";
  }

  // Sync each changed element's attributes onto the live DOM from the restored
  // markup, so the runtime's seek-reapply (which reads inline offset props off
  // the live element) folds the REVERTED values, not the stale current ones.
  const restoredById = idElementMap(new DOMParser().parseFromString(restored, "text/html"));
  for (const id of diff.changedElementIds) {
    const liveEl = doc.getElementById(id);
    const restoredEl = restoredById.get(id);
    if (liveEl && restoredEl) syncElementAttributes(liveEl, restoredEl);
  }

  const script = extractGsapScriptText(restored);
  if (script) {
    const result = applySoftReload(iframe, script, {
      onAsyncFailure: reloadPreview,
      currentTimeOverride: currentTime,
    });
    if (result === "cannot-soft-reload") {
      reloadPreview();
      return "full";
    }
    return "soft";
  }
  // No single GSAP script to re-run — the change was pure attribute/style. Re-fold
  // manual edits and hold the playhead so the synced attributes take visible effect.
  try {
    win.__player?.seek?.(currentTime);
    win.__hfStudioManualEditsApply?.();
  } catch {
    reloadPreview();
    return "full";
  }
  return "soft";
}
