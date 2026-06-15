type IframeWindow = Window & {
  __timelines?: Record<string, { kill?: () => void; pause?: () => void }>;
  __player?: { getTime?: () => number; seek?: (t: number) => void };
  __hfForceTimelineRebind?: () => void;
  __hfSuppressSceneMutations?: <T>(fn: () => T) => T;
  __hfStudioManualEditsApply?: () => void;
  gsap?: {
    timeline?: (...args: unknown[]) => unknown;
    registerPlugin?: (...plugins: unknown[]) => unknown;
    set?: (targets: Element | Element[], vars: Record<string, unknown>) => void;
    globalTimeline?: { getChildren?: (deep: boolean) => Array<{ kill?: () => void }> };
  };
  MotionPathPlugin?: unknown;
};

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

/** Check that the new script repopulated __timelines with at least one entry. */
function verifyTimelinesPopulated(win: IframeWindow): boolean {
  const tlKeys = win.__timelines
    ? Object.keys(win.__timelines).filter((k) => k !== "__proxied")
    : [];
  return tlKeys.length > 0;
}

/**
 * Replace the GSAP script in the live iframe without reloading. This preserves
 * the WebGL context and shader transition cache.
 *
 * Scoped to root-document GSAP scripts only — scripts inside `<template>`
 * elements (sub-compositions) are not visible to `querySelectorAll` and will
 * fall back to a full iframe reload.
 *
 * Returns false (triggering a full reload fallback) when:
 * - The iframe or GSAP runtime isn't available
 * - Multiple GSAP scripts are found (ambiguous which to replace)
 * - No matching GSAP script element exists in the live DOM
 */
export function applySoftReload(iframe: HTMLIFrameElement | null, scriptText: string): boolean {
  if (!iframe || !scriptText) return false;

  const win = iframe.contentWindow as IframeWindow | null;
  const doc = iframe.contentDocument;
  if (!win || !doc) return false;
  if (!win.gsap || !win.__hfForceTimelineRebind) return false;

  const gsapScripts = findGsapScriptElements(doc);
  if (gsapScripts.length !== 1) return false;
  const oldScriptEl = gsapScripts[0]!;

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

    if (timelines) {
      for (const key of Object.keys(timelines)) {
        if (key === "__proxied") continue;
        try {
          const tl = timelines[key] as {
            kill?: () => void;
            getChildren?: (deep: boolean) => Array<{ targets?: () => Element[] }>;
          };
          if (tl?.getChildren) {
            try {
              for (const child of tl.getChildren(true)) {
                if (typeof child.targets === "function") {
                  for (const t of child.targets()) allTargets.push(t);
                }
              }
            } catch {}
          }
          tl?.kill?.();
        } catch {}
        delete timelines[key];
      }
    }

    // Kill bare gsap.to/from tweens not registered on __timelines
    if (win.gsap?.globalTimeline?.getChildren) {
      try {
        for (const child of win.gsap.globalTimeline.getChildren(false)) {
          child.kill?.();
        }
      } catch {}
    }

    // Clear residual inline transforms left by killed tweens so from() tweens
    // don't read stale end values from the DOM on re-execution
    if (allTargets.length > 0 && win.gsap?.set) {
      try {
        win.gsap.set(allTargets, { clearProps: "all" });
      } catch {}
    }

    oldScriptEl.remove();

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
      const pluginScript = doc.createElement("script");
      pluginScript.src = "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/MotionPathPlugin.min.js";
      pluginScript.onload = () => executeScript();
      pluginScript.onerror = () => executeScript();
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
    // skip the __timelines check and return true optimistically.
    if (deferredToAsync) return true;
    return verifyTimelinesPopulated(win);
  } catch {
    return false;
  }
}
