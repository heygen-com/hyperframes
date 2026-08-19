// Soft-apply of undo/redo restores to the live preview: diff a restored file
// against the live one, sync attribute-only changes onto the live DOM, and
// refresh the runtime in place — avoiding the full iframe remount (black flash
// + WebGL context loss) whenever the restore is expressible without one.
import {
  applySoftReload,
  applySoftReloadFinalization,
  extractGsapScriptText,
  findGsapScriptElements,
} from "./gsapSoftReload";

type PreviewWindow = Window & {
  __player?: { seek?: (t: number) => void };
  __hfStudioManualEditsApply?: () => void;
};

/** One file's restore from the edit-history store: before (live) / after (target) bytes. */
export interface UndoRestoreFile {
  previous: string;
  restored: string;
}

/**
 * Identity for the soft diff: `data-hf-id` when present, else `id`. Nearly
 * every studio-editable element carries one of the two — z-order commits and
 * timeline patches target by id OR hf-id OR stable selector, and hf-ids are
 * stamped uniquely by the SDK — so preferring them keeps duplicate authored
 * ids distinct and selector-targeted clips inside soft-undo's reach.
 */
function elementIdentityKey(el: Element): string | null {
  const hfId = el.getAttribute("data-hf-id");
  if (hfId) return `hf:${hfId}`;
  const id = el.getAttribute("id");
  if (id) return `id:${id}`;
  return null;
}

const IDENTITY_SELECTOR = "[id], [data-hf-id]";

function identityElementMap(doc: Document): Map<string, Element> | null {
  const map = new Map<string, Element>();
  for (const el of doc.querySelectorAll(IDENTITY_SELECTOR)) {
    const key = elementIdentityKey(el);
    if (!key) continue;
    // Ambiguous identity must full-reload; silently overwriting would restore
    // one element's attributes onto another element sharing the same key.
    if (map.has(key)) return null;
    map.set(key, el);
  }
  return map;
}

// Strip identified elements to their bare identity attributes and blank GSAP
// scripts, in place: docs that differ only in identified-element attributes/
// inline-style/script text normalize equal; any residual difference is beyond
// soft-reload's reach → caller full-reloads. Both identity attributes are
// KEPT, so a change to `id`/`data-hf-id` themselves stays a residual
// (structural) difference.
function normalizeSoftResidual(doc: Document): void {
  for (const el of doc.querySelectorAll(IDENTITY_SELECTOR)) {
    const id = el.getAttribute("id");
    const hfId = el.getAttribute("data-hf-id");
    for (const name of [...el.getAttributeNames()]) {
      if (name !== "id" && name !== "data-hf-id") el.removeAttribute(name);
    }
    if (id) el.setAttribute("id", id);
    if (hfId) el.setAttribute("data-hf-id", hfId);
  }
  for (const script of findGsapScriptElements(doc)) script.textContent = "";
}

/** Same attribute set with identical values (order-insensitive). */
function attributesEqual(a: Element, b: Element): boolean {
  const aNames = a.getAttributeNames();
  if (aNames.length !== b.getAttributeNames().length) return false;
  for (const name of aNames) {
    if (a.getAttribute(name) !== b.getAttribute(name)) return false;
  }
  return true;
}

// Soft-reloadable iff the docs differ SOLELY in identified-element attributes/
// inline style and/or the GSAP script; returns the changed identity keys to
// sync onto the live DOM. Structural/text diffs → null → the caller
// full-reloads. Pure.
//
// Change detection deliberately compares each identified element's OWN
// attribute surface — never its innerHTML. Identified elements NEST (the
// composition root wraps every clip), so an innerHTML comparison at the parent
// re-detects every descendant change and rejects the restore; that was the
// original always-full-reload undo blink. Structure/text integrity is instead
// guaranteed by the normalize-residual pass below: with identified-element
// attributes stripped and scripts blanked, ANY remaining difference (text,
// added/removed/reordered nodes, un-identified element attrs) still fails the
// docs-equal check and escalates to a full reload.
export function diffSoftReloadableRestore(
  previous: string,
  restored: string,
): { changedElementKeys: string[] } | null {
  let prevDoc: Document;
  let nextDoc: Document;
  try {
    prevDoc = new DOMParser().parseFromString(previous, "text/html");
    nextDoc = new DOMParser().parseFromString(restored, "text/html");
  } catch {
    return null;
  }
  const prevByKey = identityElementMap(prevDoc);
  const nextByKey = identityElementMap(nextDoc);
  if (!prevByKey || !nextByKey) return null;
  // A different identity set means an element was added or removed (e.g. a
  // split, a delete) — structural, so soft-reload can't express it.
  if (prevByKey.size !== nextByKey.size) return null;
  const changedElementKeys: string[] = [];
  for (const [key, nextEl] of nextByKey) {
    const prevEl = prevByKey.get(key);
    if (!prevEl || prevEl.tagName !== nextEl.tagName) return null;
    if (!attributesEqual(prevEl, nextEl)) changedElementKeys.push(key);
  }
  // Confirm nothing OUTSIDE identified-element attributes and GSAP scripts changed.
  normalizeSoftResidual(prevDoc);
  normalizeSoftResidual(nextDoc);
  if (prevDoc.documentElement.outerHTML !== nextDoc.documentElement.outerHTML) return null;
  return { changedElementKeys };
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

function readGsapScriptTexts(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return findGsapScriptElements(doc).map((script) => script.textContent ?? "");
}

function hasAmbiguousGsapScriptChange(previous: string, restored: string): boolean {
  const previousScripts = readGsapScriptTexts(previous);
  const restoredScripts = readGsapScriptTexts(restored);
  if (previousScripts.length <= 1 && restoredScripts.length <= 1) return false;
  return (
    previousScripts.length !== restoredScripts.length ||
    previousScripts.some((script, index) => script !== restoredScripts[index])
  );
}

/**
 * Soft-apply an undo/redo restore to the live preview WITHOUT a full iframe
 * remount (which blanks the frame black and re-flashes the WebGL context). Only
 * the active composition — the document living in the root iframe — is eligible;
 * a sub-comp or multi-file restore falls back to `reloadPreview`.
 *
 * The restore is soft-applied when its only differences are identified-element
 * (id / data-hf-id) attributes / inline-style and/or the GSAP script (see
 * diffSoftReloadableRestore):
 *   1. Each changed element's attribute surface (inline style, data-start /
 *      -duration, the studio manual-offset props + flags) is synced onto the live
 *      element — so a canvas-position revert lands on the live DOM the runtime's
 *      seek-reapply reads from, not just on disk.
 *   2. The runtime refresh depends on what changed:
 *      - GSAP script text actually CHANGED between previous and restored → the
 *        restored script is re-run in place via applySoftReload (re-seeks to
 *        `currentTime`, re-folds manual edits).
 *      - Script unchanged or absent (the overwhelmingly common undo: z-order,
 *        lane move, timing shift, style tweak) → NO script execution — the
 *        blink-free finalization only (seek + __hfForceTimelineRebind + manual
 *        reapply, exactly the rebindPreviewTiming path), so timing-attribute
 *        reverts refresh their visibility windows. Re-running an unchanged
 *        script here used to be the biggest undo blink source: it tore down
 *        and rebuilt live timelines (and full-reloaded whenever the script
 *        couldn't be scoped) for restores that never touched it.
 *
 * Returns "soft" when applied in place, "full" when it escalated to reloadPreview
 * (ineligible restore, missing target, or a permanent soft-reload failure).
 */
// fallow-ignore-next-line complexity
export function applyUndoRestoreToPreview(
  iframe: HTMLIFrameElement | null,
  activeCompPath: string | null,
  files: Record<string, UndoRestoreFile> | undefined,
  currentTime: number,
  reloadPreview: () => void,
): "soft" | "full" {
  // The master view carries a NULL activeCompPath but the root iframe shows
  // index.html — the codebase-wide convention (`activeCompPath || "index.html"`).
  // Without this normalization every master-view undo failed the path gate and
  // full-reloaded: the original "undo always blinks".
  const activeDocPath = activeCompPath ?? "index.html";
  const paths = files ? Object.keys(files) : [];
  // Soft path only covers the single active-comp document in the root iframe.
  if (!iframe || !files || paths.length !== 1 || paths[0] !== activeDocPath) {
    reloadPreview();
    return "full";
  }
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow as PreviewWindow | null;
  if (!doc || !win) {
    reloadPreview();
    return "full";
  }
  const { previous, restored } = files[activeDocPath]!;
  const diff = diffSoftReloadableRestore(previous, restored);
  if (!diff) {
    reloadPreview();
    return "full";
  }
  // A serialized snapshot cannot identify which of several GSAP scripts owns a
  // rewrite. Keep attribute-only restores soft when every script byte is equal,
  // but fail closed before touching the live DOM when an ambiguous script changed.
  if (hasAmbiguousGsapScriptChange(previous, restored)) {
    reloadPreview();
    return "full";
  }

  // Resolve every changed pair BEFORE touching the live DOM. A missing target
  // makes the soft restore incomplete, so escalate without leaving a partially
  // restored preview behind.
  const liveByKey = identityElementMap(doc);
  const restoredByKey = identityElementMap(new DOMParser().parseFromString(restored, "text/html"));
  if (!liveByKey || !restoredByKey) {
    reloadPreview();
    return "full";
  }
  const changedTargets: Array<{ live: Element; restored: Element }> = [];
  for (const key of diff.changedElementKeys) {
    const liveEl = liveByKey.get(key);
    const restoredEl = restoredByKey.get(key);
    if (!liveEl || !restoredEl) {
      reloadPreview();
      return "full";
    }
    changedTargets.push({ live: liveEl, restored: restoredEl });
  }
  // Sync each changed element's attributes onto the live DOM from the restored
  // markup, so the runtime's seek-reapply reads the reverted values.
  for (const target of changedTargets) syncElementAttributes(target.live, target.restored);

  const restoredScript = extractGsapScriptText(restored);
  const previousScript = extractGsapScriptText(previous);
  if (restoredScript && restoredScript !== previousScript) {
    const result = applySoftReload(iframe, restoredScript, {
      onAsyncFailure: reloadPreview,
      currentTimeOverride: currentTime,
    });
    if (result === "cannot-soft-reload") {
      reloadPreview();
      return "full";
    }
    return "soft";
  }
  // Script unchanged or absent — the live timelines are still valid; only the
  // synced attributes need to take effect. Rebind-only finalization (zero
  // script execution); plain seek + manual reapply as a degraded fallback when
  // the runtime rebind hook is unavailable.
  if (applySoftReloadFinalization(iframe, currentTime)) return "soft";
  try {
    win.__player?.seek?.(currentTime);
    win.__hfStudioManualEditsApply?.();
  } catch {
    reloadPreview();
    return "full";
  }
  return "soft";
}
