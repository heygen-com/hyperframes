type IframeWindow = Window & {
  __timelines?: Record<string, { kill?: () => void; pause?: () => void }>;
  __player?: { getTime?: () => number; seek?: (t: number) => void };
  __hfForceTimelineRebind?: () => void;
  __hfSuppressSceneMutations?: <T>(fn: () => T) => T;
  __hfStudioManualEditsApply?: () => void;
  gsap?: { timeline?: (...args: unknown[]) => unknown };
};

function findGsapScriptElement(doc: Document): HTMLScriptElement | null {
  const scripts = doc.querySelectorAll<HTMLScriptElement>("script:not([src])");
  for (const script of scripts) {
    const text = script.textContent || "";
    if (text.includes("gsap.timeline") || text.includes("__timelines")) return script;
  }
  return null;
}

function extractGsapScriptFromHtml(html: string): string | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const script = findGsapScriptElement(doc);
  return script?.textContent || null;
}

export function applySoftReload(iframe: HTMLIFrameElement | null, afterHtml: string): boolean {
  if (!iframe) return false;

  const win = iframe.contentWindow as IframeWindow | null;
  const doc = iframe.contentDocument;
  if (!win || !doc) return false;
  if (!win.gsap || !win.__hfForceTimelineRebind) return false;

  const newScriptText = extractGsapScriptFromHtml(afterHtml);
  if (!newScriptText) return false;

  const oldScriptEl = findGsapScriptElement(doc);
  if (!oldScriptEl) return false;

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

    const newScript = doc.createElement("script");
    newScript.textContent = newScriptText;
    oldScriptEl.parentNode?.insertBefore(newScript, oldScriptEl);
    oldScriptEl.remove();

    win.__hfForceTimelineRebind?.();
    win.__player?.seek?.(currentTime);
    win.__hfStudioManualEditsApply?.();
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
