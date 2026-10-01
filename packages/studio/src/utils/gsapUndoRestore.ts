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
import { isCompositionTemplate } from "@hyperframes/parsers/hf-ids";
import { findAuthoredElement, parseSavedSource } from "./authoredSource";
import { STUDIO_EDIT_ATTRS } from "../components/editor/manualEditsSeekReapply";
import { markScenesStale } from "../player/sceneSwap";

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

function identityElementMap(root: ParentNode): Map<string, Element> | null {
  const map = new Map<string, Element>();
  for (const el of root.querySelectorAll(IDENTITY_SELECTOR)) {
    const key = elementIdentityKey(el);
    if (!key) continue;
    // Ambiguous identity must full-reload; silently overwriting would restore
    // one element's attributes onto another element sharing the same key.
    if (map.has(key)) return null;
    map.set(key, el);
  }
  return map;
}

// A sub-composition file wraps its markup in a template; the preview inlines that markup into its host.
function parseRestoreSource(html: string): Document {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const template of Array.from(doc.querySelectorAll("template")).filter(
    isCompositionTemplate,
  )) {
    template.replaceWith(template.content);
  }
  return doc;
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
    prevDoc = parseRestoreSource(previous);
    nextDoc = parseRestoreSource(restored);
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

// A gesture folded into the script leaves marks on the live element that every seek would re-impose.
function syncStaleEditMarks(doc: Document, restored: string): void {
  const restoredDoc = parseSavedSource(restored);
  for (const live of doc.querySelectorAll(STUDIO_EDIT_ATTRS.map((attr) => `[${attr}]`).join())) {
    const source = findAuthoredElement(restoredDoc, live);
    if (source && STUDIO_EDIT_ATTRS.some((a) => live.getAttribute(a) !== source.getAttribute(a))) {
      syncElementAttributes(live, source);
    }
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

type RestoreTarget = { live: Element; restored: Element };

/** Whether a file, template content included, carries a GSAP script. */
export function restoreHasGsapScript(html: string): boolean {
  return findGsapScriptElements(parseRestoreSource(html)).length > 0;
}

// The active document is the whole preview; a sub-composition lives in each host that inlines it.
function liveScopes(doc: Document, path: string, isActive: boolean): ParentNode[] {
  if (isActive) return [doc];
  return Array.from(doc.querySelectorAll(`[data-composition-file="${CSS.escape(path)}"]`));
}

function scopeTargets(
  scope: ParentNode,
  keys: string[],
  restoredByKey: Map<string, Element>,
): RestoreTarget[] | null {
  const liveByKey = identityElementMap(scope);
  if (!liveByKey) return null;
  const targets: RestoreTarget[] = [];
  for (const key of keys) {
    const live = liveByKey.get(key);
    const restored = restoredByKey.get(key);
    // The preview rewrites a sub-composition's own root, so its attributes are not the file's.
    if (!live || !restored || live.hasAttribute("data-hf-inner-root")) return null;
    targets.push({ live, restored });
  }
  return targets;
}

function fileTargets(
  doc: Document,
  path: string,
  isActive: boolean,
  { previous, restored }: UndoRestoreFile,
): RestoreTarget[] | null {
  // Only the active document's GSAP script can be re-run in place.
  if (!isActive && (restoreHasGsapScript(previous) || restoreHasGsapScript(restored))) return null;
  const scopes = liveScopes(doc, path, isActive);
  const diff = diffSoftReloadableRestore(previous, restored);
  if (!scopes.length || !diff || hasAmbiguousGsapScriptChange(previous, restored)) return null;
  const restoredByKey = identityElementMap(parseRestoreSource(restored));
  if (!restoredByKey) return null;
  const targets: RestoreTarget[] = [];
  for (const scope of scopes) {
    const found = scopeTargets(scope, diff.changedElementKeys, restoredByKey);
    if (!found) return null;
    targets.push(...found);
  }
  return targets;
}

/** Every live element a restore changes with its restored markup, or null when it needs a reload. */
function planRestoreTargets(
  doc: Document,
  activeDocPath: string,
  files: Record<string, UndoRestoreFile>,
): RestoreTarget[] | null {
  const targets: RestoreTarget[] = [];
  for (const [path, file] of Object.entries(files)) {
    const found = fileTargets(doc, path, path === activeDocPath, file);
    if (!found) return null;
    targets.push(...found);
  }
  return targets;
}

/**
 * Soft-apply an undo/redo restore to the live preview WITHOUT a full iframe
 * remount (which blanks the frame black and re-flashes the WebGL context). Eligible
 * files are the active composition and any sub-composition the preview inlines;
 * a file the preview does not show falls back to `reloadPreview`.
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
 *        reverts refresh their visibility windows.
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
  reload: () => void,
): "soft" | "full" {
  // The master view carries a NULL activeCompPath but the root iframe shows
  // index.html — the codebase-wide convention (`activeCompPath || "index.html"`).
  // Without this normalization every master-view undo failed the path gate and
  // full-reloaded: the original "undo always blinks".
  const activeDocPath = activeCompPath ?? "index.html";
  const paths = files ? Object.keys(files) : [];
  const reloadPreview = () => {
    markScenesStale(iframe, paths);
    reload();
  };
  const doc = iframe?.contentDocument;
  const win = iframe?.contentWindow as PreviewWindow | null;
  const changedTargets = doc && files && win ? planRestoreTargets(doc, activeDocPath, files) : null;
  if (!doc || !files || !win || !changedTargets) {
    reloadPreview();
    return "full";
  }
  // Sync each changed element's attributes onto the live DOM from the restored
  // markup, so the runtime's seek-reapply reads the reverted values.
  for (const target of changedTargets) syncElementAttributes(target.live, target.restored);

  const active = files[activeDocPath];
  const restoredScript = active ? extractGsapScriptText(active.restored) : null;
  const previousScript = active ? extractGsapScriptText(active.previous) : null;
  if (restoredScript && restoredScript !== previousScript) {
    syncStaleEditMarks(doc, active.restored);
    const result = applySoftReload(iframe, restoredScript, {
      onAsyncFailure: reloadPreview,
      currentTimeOverride: currentTime,
      authoredHtml: active.restored,
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
