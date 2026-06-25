// Gated, JSON-stringified debug logging for the 3D-transform commit/flash path.
// Silent in production; on in dev builds, or anywhere once you set
// `window.__hfDebug = true` in the console. Single `[hf-3d:<scope>]` prefix so
// the whole 3D commit pipeline is greppable, and objects are stringified so they
// survive copy/paste out of the console.
function debugEnabled(): boolean {
  try {
    if ((window as unknown as { __hfDebug?: boolean }).__hfDebug) return true;
  } catch {
    /* no window (SSR) */
  }
  try {
    return import.meta.env?.DEV === true;
  } catch {
    return false;
  }
}

export function log3d(scope: string, data?: unknown): void {
  if (!debugEnabled()) return;
  let payload = "";
  if (data !== undefined) {
    try {
      payload = typeof data === "string" ? data : JSON.stringify(data);
    } catch {
      payload = String(data);
    }
  }
  // eslint-disable-next-line no-console -- intentional opt-in debug surface
  console.log(`[hf-3d:${scope}]`, payload);
}
