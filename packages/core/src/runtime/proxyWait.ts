const MAX_FAILED_ASKS = 3;

/** Asks for one byte of a `?hf-proxy=` URL until it is served, after each Retry-After: while the
 * server answers 202 (copy being made) or 503 (queue full), and after up to 3 failed asks. */
export async function waitForServedProxy(href: string, live: () => boolean): Promise<boolean> {
  let failed = 0;
  while (live()) {
    const res = await fetch(href, { headers: { Range: "bytes=0-0" }, cache: "no-store" }).catch(
      () => null,
    );
    void res?.body?.cancel().catch(() => {});
    const pending = res?.status === 202 || res?.status === 503;
    if (!pending && res?.ok) return true;
    if (!pending && ++failed > MAX_FAILED_ASKS) return false;
    const seconds = Math.min(Number(res?.headers.get("Retry-After")) || 2, 30);
    await new Promise((resolveWait) => setTimeout(resolveWait, seconds * 1000));
  }
  return false;
}
