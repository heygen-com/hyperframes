import { COLOR_GRADING_SOURCE_HIDDEN_ATTR } from "@hyperframes/core/color-grading";
import { applyAuthoredInlineOpacity, readStampedAuthoredOpacity } from "./authoredOpacity";

type IframeWindow = Window & {
  __timelines?: Record<string, { kill?: () => void; pause?: () => void }>;
  __player?: { getTime?: () => number; seek?: (t: number) => void };
  __hfForceTimelineRebind?: () => void;
  __hfSuppressSceneMutations?: <T>(fn: () => T) => T;
  __hfStudioManualEditsApply?: () => void;
  // Set while a MotionPathPlugin <script> is being fetched, so overlapping soft
  // reloads (each needing the plugin) don't queue duplicate plugin scripts that
  // re-flash the iframe. Cleared once the plugin loads or errors.
  __hfMotionPathPluginLoading?: boolean;
  gsap?: {
    timeline?: (...args: unknown[]) => unknown;
    registerPlugin?: (...plugins: unknown[]) => unknown;
    set?: (targets: Element | Element[], vars: Record<string, unknown>) => void;
    globalTimeline?: { getChildren?: (deep: boolean) => Array<{ kill?: () => void }> };
  };
  MotionPathPlugin?: unknown;
};

/**
 * CDN URL for the GSAP MotionPathPlugin. Shared between the one-time preview
 * bootstrap (ensureMotionPathPluginLoaded) and the soft-reload fallback so the
 * version is pinned in a single place.
 */
const MOTION_PATH_PLUGIN_CDN =
  "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/MotionPathPlugin.min.js";

/**
 * Pre-load + register MotionPathPlugin ONCE in the preview iframe so
 * `win.MotionPathPlugin` is reliably set before any studio edit. Called from the
 * preview bootstrap (NLELayout's onIframeLoad) on every iframe load.
 *
 * Why: when a user ADDS a motion path to a composition that never used one, the
 * plugin isn't loaded, so the first soft reload takes the async `<script src>`
 * load path — the timeline is killed/cleared while the CDN load is pending,
 * producing a visible flash. Loading it eagerly here means the soft reload runs
 * synchronously and `needsMotionPath && !win.MotionPathPlugin` never fires for
 * studio edits.
 *
 * Idempotent (no-ops once the plugin is present or already loading) and
 * defensive: no-ops without gsap/registerPlugin and tolerates a CDN failure
 * (the soft-reload async fallback in applySoftReload still covers that case).
 */
export function ensureMotionPathPluginLoaded(iframe: HTMLIFrameElement | null): void {
  if (!iframe?.contentWindow || !iframe.contentDocument) return;
  const win = iframe.contentWindow as IframeWindow;
  const doc = iframe.contentDocument;

  // Already registered (composition shipped its own plugin, or a prior bootstrap
  // ran) — register it on gsap to be safe, then bail.
  if (win.MotionPathPlugin) {
    try {
      if (win.gsap?.registerPlugin) win.gsap.registerPlugin(win.MotionPathPlugin);
    } catch {}
    return;
  }
  if (!win.gsap?.registerPlugin) return;
  // A load is already in flight for this iframe — don't queue a second script.
  if (win.__hfMotionPathPluginLoading) return;

  try {
    win.__hfMotionPathPluginLoading = true;
    const pluginScript = doc.createElement("script");
    pluginScript.src = MOTION_PATH_PLUGIN_CDN;
    const finalize = () => {
      win.__hfMotionPathPluginLoading = false;
      try {
        if (win.MotionPathPlugin && win.gsap?.registerPlugin) {
          win.gsap.registerPlugin(win.MotionPathPlugin);
        }
      } catch {}
    };
    pluginScript.onload = finalize;
    pluginScript.onerror = finalize;
    doc.head.appendChild(pluginScript);
  } catch {
    win.__hfMotionPathPluginLoading = false;
  }
}

function isGsapScript(text: string): boolean {
  return (
    text.includes("gsap.timeline") ||
    text.includes("__timelines") ||
    text.includes(".to(") ||
    text.includes(".set(")
  );
}

function findGsapScriptElements(doc: Document): HTMLScriptElement[] {
  const results: HTMLScriptElement[] = [];
  const scripts = doc.querySelectorAll<HTMLScriptElement>("script:not([src])");
  for (const script of scripts) {
    if (isGsapScript(script.textContent || "")) results.push(script);
  }
  return results;
}

/**
 * Extract the GSAP timeline script text from a serialized HTML document, for
 * feeding into applySoftReload. Returns null when zero or multiple GSAP scripts
 * are present (ambiguous — caller should fall back to a full reload), matching
 * applySoftReload's own single-script requirement.
 */
export function extractGsapScriptText(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const scripts = findGsapScriptElements(doc);
  if (scripts.length !== 1) return null;
  return scripts[0].textContent || null;
}

/**
 * Confirm the re-run repopulated the timeline(s) this script owns. We check the
 * EXPECTED keys (the ones the script re-registers), not merely "any key": a
 * scoped soft reload only re-runs ONE composition, so the right success signal is
 * "my target keys are back", not "the global map is non-empty". Checking the
 * exact keys avoids the transient false where the global map momentarily looks
 * empty right after the re-run — the spurious trigger of the full-remount fallback.
 */
function verifyTimelinesPopulated(win: IframeWindow, targetKeys: string[]): boolean {
  const timelines = win.__timelines;
  if (!timelines) return false;
  if (targetKeys.length > 0) {
    return targetKeys.every((key) => timelines[key] != null);
  }
  return Object.keys(timelines).filter((k) => k !== "__proxied").length > 0;
}

/**
 * Outcome of a soft-reload attempt. Callers must distinguish PERMANENT failures
 * (the preview genuinely can't be soft-updated — escalate to a full reload) from
 * the TRANSIENT post-run empty-timeline window (the live `gsap.set` already shows
 * the correct value — do NOT escalate; a remount would re-flash the WebGL context
 * and revert subcomposition keyframes):
 *
 * - `"applied"`            — the script ran (or is deferred to the async plugin
 *                            load and WILL run). The preview is/will be correct.
 * - `"verify-failed"`      — TRANSIENT: the re-run happened but `__timelines`
 *                            momentarily read empty. Live state is correct → do
 *                            NOT escalate. (Was a bare `false` before.)
 * - `"cannot-soft-reload"` — PERMANENT/STRUCTURAL: no gsap runtime, no rebind
 *                            hook, no scopable target key, or no script element
 *                            to replace. The preview is stale/broken → escalate.
 *
 * The async MotionPath-plugin load failure is still surfaced via
 * `onAsyncFailure` (it fires after this returned `"applied"` optimistically).
 */
export type SoftReloadResult = "applied" | "verify-failed" | "cannot-soft-reload";

/**
 * Replace the GSAP script in the live iframe without reloading. This preserves
 * the WebGL context and shader transition cache.
 *
 * Scoped to root-document GSAP scripts only — scripts inside `<template>`
 * elements (sub-compositions) are not visible to `querySelectorAll` and will
 * fall back to a full iframe reload.
 *
 * Returns `"cannot-soft-reload"` (caller should full-reload) when:
 * - The iframe or GSAP runtime isn't available
 * - The rebind hook isn't installed
 * - The script registers no scopable `__timelines` key
 * - No GSAP script element exists in the live DOM
 * - The synchronous re-run threw
 *
 * Returns `"verify-failed"` when the re-run executed but the target timeline
 * keys read empty in the transient post-run window (live state is still correct).
 *
 * `onAsyncFailure` is invoked when the soft reload was deferred to load the
 * MotionPath plugin (so this returned `"applied"` optimistically) but the plugin
 * `<script>` then failed to load — the iframe is left without the plugin and the
 * caller should perform a full reload to recover. It never fires on the
 * synchronous paths.
 */
export interface SoftReloadOptions {
  /** Escalation for async plugin-load failures (e.g. MotionPath CDN error). */
  onAsyncFailure?: () => void;
  /** Seek target for the rebuilt timeline; defaults to the iframe player time. */
  currentTimeOverride?: number;
  /** After-write file HTML — the primary source for authored-opacity restore. */
  authoredHtml?: string;
}

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
  const win = iframe.contentWindow as IframeWindow | null;
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

export function applySoftReload(
  iframe: HTMLIFrameElement | null,
  scriptText: string,
  options: SoftReloadOptions = {},
): SoftReloadResult {
  const { onAsyncFailure, currentTimeOverride, authoredHtml } = options;
  if (!iframe || !scriptText) return "cannot-soft-reload";

  const win = iframe.contentWindow as IframeWindow | null;
  const doc = iframe.contentDocument;
  if (!win || !doc) return "cannot-soft-reload";
  if (!win.gsap || !win.__hfForceTimelineRebind) return "cannot-soft-reload";

  // Which composition(s) does this script rebuild? A soft reload re-runs ONE
  // composition's GSAP script, which re-registers its own window.__timelines[key].
  // In a multi-composition preview (top-level + inlined subcompositions) each
  // composition owns a separate timeline keyed by its id, and they're all children
  // of the global timeline — so tearing down ALL of them (or the global timeline's
  // children) and re-running a single script wipes every OTHER composition,
  // reverting its edits. Scope the teardown to the keys THIS script re-registers.
  const targetKeys = [...scriptText.matchAll(/__timelines\s*\[\s*["'`]([^"'`]+)["'`]\s*\]/g)]
    .map((m) => m[1]!)
    .filter((key) => key !== "__proxied");
  if (targetKeys.length === 0) return "cannot-soft-reload"; // can't scope safely → full reload
  const gsapScripts = findGsapScriptElements(doc);
  if (gsapScripts.length === 0) return "cannot-soft-reload";
  // Remove only the stale script element(s) that registered a target key; one we
  // can't match in the doc is left alone (re-running appends a fresh element).
  const staleScripts = gsapScripts.filter((script) =>
    targetKeys.some((key) => {
      const text = script.textContent || "";
      return text.includes(`__timelines["${key}"]`) || text.includes(`__timelines['${key}']`);
    }),
  );
  // Multiple GSAP scripts exist but none registers a key this script owns — we
  // can't identify which element to replace (ambiguous, matching
  // extractGsapScriptText's single-script requirement). Escalate to a full reload
  // rather than killing the target timeline and appending an orphan script.
  if (gsapScripts.length > 1 && staleScripts.length === 0) return "cannot-soft-reload";

  // Prefer the caller-supplied scrub position (the studio's own authoritative
  // currentTime, e.g. usePlayerStore) over the iframe's raw `__player.getTime()`:
  // the two can desync (a keyframe-node drag parks the playhead via the store
  // BEFORE this reload's async commit resolves, and the iframe's own GSAP clock
  // doesn't reliably reflect that yet), which re-seeks the freshly rebuilt
  // timeline to the wrong frame and leaves the element (and its overlay)
  // rendered at a stale/unrelated position.
  const currentTime = currentTimeOverride ?? win.__player?.getTime?.() ?? 0;

  // Track whether the MotionPath async path was taken. When it is, the script
  // executes inside pluginScript.onload — after applySoftReload has already
  // returned. We optimistically return true because the script WILL execute
  // once the plugin loads; the alternative (returning false) would trigger a
  // full iframe reload that destroys the very WebGL context we're preserving.
  let deferredToAsync = false;

  // Authored-opacity resolution for the restore loop below. Three-state:
  //   "0.98" — the element's authored inline opacity
  //   ""     — resolved, and the element has NO authored inline opacity
  //   null   — unknown (no authored HTML supplied, element not found in it,
  //            and no runtime parse-time stamp)
  // The just-written file (`authoredHtml`) is the current truth; the runtime's
  // parse-time stamp (data-hf-authored-opacity, installAuthoredOpacityCapture)
  // covers elements the file lookup can't resolve. Parsed lazily, at most once.
  let authoredDoc: Document | null | undefined;
  const findAuthoredSource = (el: HTMLElement): Element | null => {
    if (authoredDoc === undefined) {
      try {
        authoredDoc = authoredHtml
          ? new DOMParser().parseFromString(authoredHtml, "text/html")
          : null;
      } catch {
        authoredDoc = null;
      }
    }
    if (!authoredDoc) return null;
    const hfId = el.getAttribute("data-hf-id");
    if (hfId) return authoredDoc.querySelector(`[data-hf-id="${hfId}"]`);
    return el.id ? authoredDoc.getElementById(el.id) : null;
  };
  const readAuthoredOpacity = (el: HTMLElement): string | null => {
    const source = findAuthoredSource(el);
    if (source instanceof HTMLElement) return source.style.opacity;
    return readStampedAuthoredOpacity(el);
  };

  // fallow-ignore-next-line complexity
  const doReload = () => {
    const timelines = win.__timelines;
    const allTargets: Element[] = [];

    // Kill ONLY the target composition's timeline(s) — leaving every other
    // composition's timeline (and its children on the global timeline) intact.
    if (timelines) {
      for (const key of targetKeys) {
        const tl = timelines[key] as
          | {
              kill?: () => void;
              getChildren?: (deep: boolean) => Array<{ targets?: () => Element[] }>;
            }
          | undefined;
        if (!tl) continue;
        if (tl.getChildren) {
          try {
            for (const child of tl.getChildren(true)) {
              if (typeof child.targets === "function") {
                for (const t of child.targets()) allTargets.push(t);
              }
            }
          } catch {}
        }
        try {
          tl.kill?.();
        } catch {}
        delete timelines[key];
      }
    }

    // Also reset elements carrying a GSAP-applied inline `transform` that the
    // timeline-children sweep above missed — a dragged element whose position
    // was a standalone `gsap.set` (never a timeline child), or one whose
    // keyframes were just removed (no longer in any timeline). Their last
    // `gsap.set` transform is otherwise orphaned: the re-run won't re-set it
    // and the sweep above can't see it, so the element renders offset from its
    // source position (matching the overlay) until a full reload. The clear
    // below runs BEFORE the re-run, which re-applies the transform for any
    // element the new script still animates.
    const seenTargets = new Set<Element>(allTargets);
    for (const el of doc.querySelectorAll<HTMLElement>("[style*='transform']")) {
      // Gate on the GSAP cache (`_gsap`) so we only reset transforms GSAP owns —
      // never strip an authored, non-GSAP inline transform.
      if (el.style.transform && "_gsap" in el && !seenTargets.has(el)) {
        seenTargets.add(el);
        allTargets.push(el);
      }
    }

    // Reset GSAP's internal transform cache so from() tweens don't read stale
    // end values. `clearProps: "all"` is needed to flush the cache, but it also
    // nukes the element's CSS base (position, width, height, etc.) from the
    // HTML `style=""` attribute. Save → clear → restore → strip `transform`.
    if (allTargets.length > 0 && win.gsap?.set) {
      const saved: Array<[HTMLElement, string]> = [];
      for (const el of allTargets) {
        // Iframe-realm node: instanceof HTMLElement fails across realms, and
        // gsap targets() only yields elements here — style access is duck-typed.
        const styled = el as HTMLElement;
        if (styled.style?.cssText != null) saved.push([styled, styled.style.cssText]);
      }
      try {
        win.gsap.set(allTargets, { clearProps: "all" });
      } catch {}
      for (const [el, css] of saved) {
        const s = el.style;
        s.cssText = css;
        s.removeProperty("transform");
        // The restored cssText carries RUNTIME opacity, not authored opacity:
        // a mid-flight tween's interpolated value, or the color-grading hide
        // (`opacity: 0 !important`). The re-run script's tweens re-initialize
        // against it — a from() captures it as its END, a to() as its START —
        // turning the transient into the tween's permanent bound (dimmed or
        // invisible elements). Put the AUTHORED inline opacity back; the seek
        // below re-renders the correct animated value either way.
        const authored = readAuthoredOpacity(el);
        if (authored !== null) {
          applyAuthoredInlineOpacity(s, authored);
        } else if (
          el.hasAttribute(COLOR_GRADING_SOURCE_HIDDEN_ATTR) &&
          s.getPropertyValue("opacity") === "0" &&
          s.getPropertyPriority("opacity") === "important"
        ) {
          // Authored value unknown, but this is definitely the grading hide —
          // never let a from() capture 0; fall back to the CSS cascade.
          s.removeProperty("opacity");
        }
      }
    }

    for (const script of staleScripts) script.remove();

    const executeScript = () => {
      if (win.MotionPathPlugin && win.gsap?.registerPlugin) {
        win.gsap.registerPlugin(win.MotionPathPlugin);
      }
      const s = doc.createElement("script");
      s.textContent = `(function(){${scriptText}\n})();`;
      doc.body.appendChild(s);
      // Seek BEFORE rebind: __hfForceTimelineRebind's own internal force-render
      // (see init.ts) renders the freshly-created timeline at whatever the
      // runtime's internal scrub position already is, not at whatever we pass
      // here afterward — a redundant seek() call after rebind can be a GSAP
      // no-op if the timeline already reports being at that time internally.
      win.__player?.seek?.(currentTime);
      win.__hfForceTimelineRebind?.();
      win.__hfStudioManualEditsApply?.();
    };

    const needsMotionPath = /motionPath\s*[:{]/.test(scriptText);
    if (needsMotionPath && !win.MotionPathPlugin && win.gsap) {
      deferredToAsync = true;
      // A prior soft reload is already fetching the plugin — don't queue a second
      // <script> (it re-flashes the iframe). Defer THIS script's execution until
      // the in-flight load settles via a one-shot poll. The bootstrap guard is
      // the single source of truth for "plugin fetch in progress".
      if (win.__hfMotionPathPluginLoading) {
        const started = Date.now();
        const poll = win.setInterval(() => {
          if (win.MotionPathPlugin) {
            win.clearInterval(poll);
            executeScript();
          } else if (!win.__hfMotionPathPluginLoading || Date.now() - started > 10000) {
            // The in-flight load finished without registering the plugin (errored)
            // or we timed out — recover with a full reload instead of running a
            // script that references a missing plugin.
            win.clearInterval(poll);
            onAsyncFailure?.();
          }
        }, 50);
        return;
      }
      win.__hfMotionPathPluginLoading = true;
      const pluginScript = doc.createElement("script");
      pluginScript.src = MOTION_PATH_PLUGIN_CDN;
      pluginScript.onload = () => {
        win.__hfMotionPathPluginLoading = false;
        executeScript();
      };
      pluginScript.onerror = () => {
        // The plugin failed to load. Running executeScript() now would leave the
        // iframe with a motionPath tween referencing a missing plugin while the
        // caller already thinks the soft reload succeeded. Signal failure so the
        // caller can full-reload (which fetches the plugin fresh) instead.
        win.__hfMotionPathPluginLoading = false;
        onAsyncFailure?.();
      };
      doc.head.appendChild(pluginScript);
      return;
    }

    executeScript();
  };

  try {
    if (win.__hfSuppressSceneMutations) {
      win.__hfSuppressSceneMutations(doReload);
    } else {
      doReload();
    }
    // When MotionPath needs async loading, the script hasn't executed yet —
    // skip the __timelines check and report success optimistically (the script
    // WILL run on plugin load; onAsyncFailure covers the CDN-error case).
    if (deferredToAsync) return "applied";
    // The re-run executed. If the target keys read back, we're done; otherwise
    // it's the TRANSIENT empty-timeline window (live state is correct) — surfaced
    // as "verify-failed" so callers know NOT to escalate.
    return verifyTimelinesPopulated(win, targetKeys) ? "applied" : "verify-failed";
  } catch {
    // The synchronous re-run threw — the preview is now genuinely broken (target
    // timeline killed, script not re-registered). Escalate to a full reload.
    return "cannot-soft-reload";
  }
}
