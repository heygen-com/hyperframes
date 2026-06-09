type IframeWindow = Window & {
  __timelines?: Record<string, { kill?: () => void; pause?: () => void }>;
  __player?: { getTime?: () => number; seek?: (t: number) => void };
  __hfForceTimelineRebind?: () => void;
  __hfSuppressSceneMutations?: <T>(fn: () => T) => T;
  __hfStudioManualEditsApply?: () => void;
  gsap?: {
    timeline?: (...args: unknown[]) => unknown;
    registerPlugin?: (...plugins: unknown[]) => unknown;
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

  const doReload = () => {
    const timelines = win.__timelines;
    if (timelines) {
      for (const key of Object.keys(timelines)) {
        try {
          timelines[key]?.kill?.();
        } catch {}
        delete timelines[key];
      }
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

    // Load MotionPathPlugin on demand if the script uses motionPath.
    // Uses the same CDN as composition templates (GSAP_CDN in constants.ts).
    const needsMotionPath = /motionPath\s*[:{]/.test(scriptText);
    if (needsMotionPath && !win.MotionPathPlugin && win.gsap) {
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
    return true;
  } catch {
    return false;
  }
}
