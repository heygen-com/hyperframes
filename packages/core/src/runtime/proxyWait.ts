import {
  PREVIEW_PROXY_PRIORITY_HEADER,
  PREVIEW_PROXY_PROGRESS_HEADER,
  PREVIEW_PROXY_RETRY_PARAM,
} from "../previewProxyBox";

const MAX_FAILED_ASKS = 3;

function withoutRetryFlag(href: string): string {
  const url = new URL(href, document.baseURI);
  url.searchParams.delete(PREVIEW_PROXY_RETRY_PARAM);
  return url.href;
}

function askHeaders(atPlayhead: boolean): Record<string, string> {
  const headers: Record<string, string> = { Range: "bytes=0-0" };
  if (atPlayhead) headers[PREVIEW_PROXY_PRIORITY_HEADER] = "1";
  return headers;
}

function reportProgress(res: Response | null, onProgress?: (fraction: number) => void): void {
  const reached = res?.status === 202 ? res.headers.get(PREVIEW_PROXY_PROGRESS_HEADER) : null;
  if (reached !== null && Number.isFinite(Number(reached))) {
    onProgress?.(Math.min(1, Math.max(0, Number(reached))));
  }
}

/** Asks for one byte of a `?hf-proxy=` URL until it is served, after each Retry-After: while the
 * server answers 202 (copy being made) or 503 (queue full), and after up to 3 failed asks. */
export async function waitForServedProxy(
  href: string,
  live: () => boolean,
  onProgress?: (fraction: number) => void,
  atPlayhead: () => boolean = () => false,
): Promise<boolean> {
  let failed = 0;
  let ask = href;
  while (live()) {
    const headers = askHeaders(atPlayhead());
    const res = await fetch(ask, { headers, cache: "no-store" }).catch(() => null);
    ask = withoutRetryFlag(href);
    void res?.body?.cancel().catch(() => {});
    const pending = res?.status === 202 || res?.status === 503;
    reportProgress(res, onProgress);
    if (!pending && res?.ok) return true;
    if (!pending && ++failed > MAX_FAILED_ASKS) return false;
    const seconds = Math.min(Number(res?.headers.get("Retry-After")) || 2, 30);
    await new Promise((resolveWait) => setTimeout(resolveWait, seconds * 1000));
  }
  return false;
}
