import type { PreviewSourceFacts } from "../previewProxyBox";

declare global {
  interface Window {
    __HF_MEDIA_SOURCE_FACTS__?: Record<string, PreviewSourceFacts>;
  }
}

export function currentSrcValue(el: HTMLMediaElement): string {
  return el.currentSrc || el.src;
}

/** The decoded, query-free pathname the server's maps are keyed by; null with no src or a cross-origin one. */
export function deriveCodecMapKey(el: HTMLMediaElement): string | null {
  const raw = currentSrcValue(el);
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw, document.baseURI);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  try {
    return decodeURIComponent(url.pathname);
  } catch {
    return url.pathname;
  }
}

/** The keys carry no route prefix, so the longest key that ends the pathname wins. */
function lookupLongestExactSuffix<T>(pathname: string, map: Record<string, T>): T | null {
  let bestKey: string | null = null;
  for (const key of Object.keys(map)) {
    if (!pathname.endsWith(key)) continue;
    if (bestKey === null || key.length > bestKey.length) bestKey = key;
  }
  return bestKey ? (map[bestKey] ?? null) : null;
}

function lookupNormalizedSuffix<T>(pathname: string, map: Record<string, T>): T | null {
  // Exact stays authoritative; a case or Unicode spelling difference matches only when one longest key is unambiguous.
  const normalizedPathname = pathname.normalize("NFC").toLowerCase();
  let normalizedBestLength = -1;
  let normalizedBest: T | null = null;
  let ambiguous = false;
  for (const [key, entry] of Object.entries(map)) {
    const normalizedKey = key.normalize("NFC").toLowerCase();
    if (!normalizedPathname.endsWith(normalizedKey)) continue;
    if (normalizedKey.length > normalizedBestLength) {
      normalizedBestLength = normalizedKey.length;
      normalizedBest = entry;
      ambiguous = false;
    } else if (normalizedKey.length === normalizedBestLength) {
      ambiguous = true;
    }
  }
  return ambiguous ? null : normalizedBest;
}

export function lookupCodecMapEntry<T>(pathname: string, map: Record<string, T>): T | null {
  return (
    map[pathname] ??
    lookupLongestExactSuffix(pathname, map) ??
    lookupNormalizedSuffix(pathname, map)
  );
}

export function sourceFactsOf(el: HTMLMediaElement): PreviewSourceFacts | null {
  const facts = window.__HF_MEDIA_SOURCE_FACTS__;
  const key = deriveCodecMapKey(el);
  return facts && key !== null ? lookupCodecMapEntry(key, facts) : null;
}
