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
export function applySoftReload(
  iframe: HTMLIFrameElement | null,
  scriptText: string,
  onAsyncFailure?: () => void,
): SoftReloadResult {
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

  const currentTime = win.__player?.getTime?.() ?? 0;

  // Track whether the MotionPath async path was taken. When it is, the script
  // executes inside pluginScript.onload — after applySoftReload has already
  // returned. We optimistically return true because the script WILL execute
  // once the plugin loads; the alternative (returning false) would trigger a
  // full iframe reload that destroys the very WebGL context we're preserving.
  let deferredToAsync = false;

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
      const saved: Array<[Element, string]> = [];
      for (const el of allTargets) {
        const s = (el as HTMLElement).style;
        if (s?.cssText != null) saved.push([el, s.cssText]);
      }
      try {
        win.gsap.set(allTargets, { clearProps: "all" });
      } catch {}
      for (const [el, css] of saved) {
        const s = (el as HTMLElement).style;
        if (!s) continue;
        s.cssText = css;
        s.removeProperty("transform");
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
      win.__hfForceTimelineRebind?.();
      win.__player?.seek?.(currentTime);
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
