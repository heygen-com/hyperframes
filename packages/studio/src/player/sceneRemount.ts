import { useCallback, useState, type SetStateAction } from "react";

// Which files the next preview reload is for. A reload with no paths reloads the whole film.
let pendingPaths: Set<string> | "film" | null = null;

export function notePreviewReload(paths?: readonly string[]): void {
  if (!paths?.length || pendingPaths === "film") {
    pendingPaths = "film";
    return;
  }
  pendingPaths = new Set([...(pendingPaths ?? []), ...paths]);
}

export function takePreviewReloadPaths(): string[] | null {
  const taken = pendingPaths;
  pendingPaths = null;
  return taken && taken !== "film" ? [...taken] : null;
}

type RemountWindow = Window & { __hfRemountComposition?: (src: string) => Promise<void> };

/**
 * The in-place swap for these project files, or null when one of them is not a scene mounted in
 * the live preview (then only a full reload shows the change).
 */
export function sceneRemountFor(
  iframe: HTMLIFrameElement,
  paths: readonly string[],
): (() => Promise<void>) | null {
  const remount = (iframe.contentWindow as RemountWindow | null)?.__hfRemountComposition;
  const doc = iframe.contentDocument;
  if (typeof remount !== "function" || !doc) return null;
  const srcByUrl = new Map<string, string>();
  for (const host of doc.querySelectorAll("[data-composition-src]")) {
    const src = host.getAttribute("data-composition-src") ?? "";
    const url = resolveUrl(src, doc.baseURI);
    if (url) srcByUrl.set(url, src);
  }
  const srcs = paths.map((path) => srcByUrl.get(resolveUrl(path, doc.baseURI) ?? ""));
  if (srcs.some((src) => src === undefined)) return null;
  return async () => {
    for (const src of srcs) await remount.call(iframe.contentWindow, src as string);
  };
}

function resolveUrl(path: string, base: string): string | null {
  try {
    return new URL(path, base).href;
  } catch {
    return null;
  }
}

/**
 * The preview reload counter. `reloadPreview(paths)` names the scene files that changed; every other
 * bump, including `setRefreshKey`, reloads the whole film.
 */
export function usePreviewReloadKey() {
  const [refreshKey, setKey] = useState(0);
  const setRefreshKey = useCallback((update: SetStateAction<number>) => {
    notePreviewReload();
    setKey(update);
  }, []);
  const reloadPreview = useCallback((changedPaths?: readonly string[]) => {
    notePreviewReload(Array.isArray(changedPaths) ? changedPaths : undefined);
    setKey((key) => key + 1);
  }, []);
  return { refreshKey, setRefreshKey, reloadPreview };
}
