type AnimeInstance = {
  pause?: () => void;
  revert?: () => void;
  seek?: (timeMs: number) => void;
};

type AnimeRegistration = {
  id?: string;
  instance?: AnimeInstance;
};

type AnimeRegistry = Record<string, AnimeRegistration | AnimeInstance | undefined>;

type AnimeIframeWindow = Window & {
  __hfAnime?: AnimeRegistry;
  __hfSuppressSceneMutations?: <T>(fn: () => T) => T;
  __player?: { getTime?: () => number; seek?: (time: number) => void };
  hyperframesAnime?: {
    get?: (id: string) => AnimeRegistration | null;
    register?: (id: string, instance: AnimeInstance) => unknown;
    unregister?: (id: string) => unknown;
  };
};

export type AnimeSoftReloadResult = "applied" | "verify-failed" | "cannot-soft-reload";

function isAnimeIframeWindow(value: Window | null): value is AnimeIframeWindow {
  return value !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAnimeInstance(value: unknown): value is AnimeInstance {
  if (!isRecord(value)) return false;
  return (
    typeof value.pause === "function" ||
    typeof value.revert === "function" ||
    typeof value.seek === "function"
  );
}

function registrationInstance(value: unknown): AnimeInstance | null {
  if (isRecord(value) && isAnimeInstance(value.instance)) return value.instance;
  return isAnimeInstance(value) ? value : null;
}

function isAnimeScript(text: string): boolean {
  return (
    /\banime\s*\.\s*(?:animate|createTimeline|timeline)\s*\(/.test(text) ||
    /\bhyperframesAnime\s*\.\s*register\s*\(/.test(text) ||
    /\bwindow\s*\.\s*__hfAnime\b/.test(text)
  );
}

function findAnimeScriptElements(doc: Document): HTMLScriptElement[] {
  const results: HTMLScriptElement[] = [];
  const scripts = doc.querySelectorAll<HTMLScriptElement>("script:not([src])");
  for (const script of scripts) {
    if (isAnimeScript(script.textContent || "")) results.push(script);
  }
  return results;
}

function registrationIds(scriptText: string): string[] {
  return [...scriptText.matchAll(/hyperframesAnime\s*\.\s*register\s*\(\s*["'`]([^"'`]+)["'`]/g)]
    .map((match) => match[1])
    .filter((id): id is string => Boolean(id));
}

export function extractAnimeScriptText(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const scripts = findAnimeScriptElements(doc);
  if (scripts.length !== 1) return null;
  return scripts[0].textContent || null;
}

function existingRegistration(win: AnimeIframeWindow, id: string): AnimeInstance | null {
  const fromApi = win.hyperframesAnime?.get?.(id);
  const apiInstance = registrationInstance(fromApi);
  if (apiInstance) return apiInstance;
  return registrationInstance(win.__hfAnime?.[id]);
}

function unregisterExisting(win: AnimeIframeWindow, id: string): void {
  const instance = existingRegistration(win, id);
  try {
    instance?.revert?.();
  } catch {}
  try {
    instance?.pause?.();
  } catch {}
  try {
    win.hyperframesAnime?.unregister?.(id);
  } catch {}
  if (win.__hfAnime) {
    Reflect.deleteProperty(win.__hfAnime, id);
  }
}

function verifyAnimeRegistrations(win: AnimeIframeWindow, ids: string[]): boolean {
  return ids.every((id) => Boolean(win.hyperframesAnime?.get?.(id) ?? win.__hfAnime?.[id]));
}

export function applyAnimeSoftReload(
  iframe: HTMLIFrameElement | null,
  scriptText: string,
  onAsyncFailure?: () => void,
  currentTimeOverride?: number,
): AnimeSoftReloadResult {
  void onAsyncFailure;
  if (!iframe || !scriptText) return "cannot-soft-reload";

  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  if (!isAnimeIframeWindow(win) || !doc) return "cannot-soft-reload";
  if (!win.hyperframesAnime?.register) return "cannot-soft-reload";

  const targetIds = registrationIds(scriptText);
  if (targetIds.length === 0) return "cannot-soft-reload";

  const animeScripts = findAnimeScriptElements(doc);
  if (animeScripts.length === 0) return "cannot-soft-reload";
  const staleScripts = animeScripts.filter((script) => {
    const text = script.textContent || "";
    return targetIds.some(
      (id) => text.includes(`register("${id}"`) || text.includes(`register('${id}'`),
    );
  });
  if (animeScripts.length > 1 && staleScripts.length === 0) return "cannot-soft-reload";

  const currentTime = currentTimeOverride ?? win.__player?.getTime?.() ?? 0;

  const doReload = () => {
    for (const id of targetIds) unregisterExisting(win, id);
    for (const script of staleScripts.length > 0 ? staleScripts : animeScripts) {
      script.remove();
    }
    const script = doc.createElement("script");
    script.textContent = `(function(){${scriptText}\n})();`;
    doc.body.appendChild(script);
    win.__player?.seek?.(currentTime);
  };

  try {
    if (win.__hfSuppressSceneMutations) {
      win.__hfSuppressSceneMutations(doReload);
    } else {
      doReload();
    }
    return verifyAnimeRegistrations(win, targetIds) ? "applied" : "verify-failed";
  } catch {
    return "cannot-soft-reload";
  }
}
