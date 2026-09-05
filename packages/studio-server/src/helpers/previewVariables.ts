/**
 * Inject preview variable overrides: `?variables=<json>` becomes
 * `window.__hfVariables` set before any composition script runs — the exact
 * global the engine sets via evaluateOnNewDocument at render time
 * (engine/src/services/frameCapture.ts), so preview-with-values cannot
 * diverge from render behavior. The runtime's getVariables() merges these
 * overrides over the declared defaults.
 */
export function injectPreviewVariables(html: string, values: Record<string, unknown>): string {
  // <-escape prevents a string value containing "</script>" from
  // breaking out of the injected tag.
  const json = JSON.stringify(values).replace(/</g, "\\u003c");
  const tag = `<script data-hf-preview-variables>window.__hfVariables=${json};</script>`;
  // Insert as early as possible without ever landing before the doctype —
  // content before <!doctype> flips the document into quirks mode, so the
  // fallback chain is <head…> → <html…> → after the doctype → prepend.
  for (const pattern of [/<head/i, /<html/i, /^\s*<!doctype/i]) {
    const match = pattern.exec(html);
    if (match) {
      // If the first prefix has no closing >, no later prefix can close either.
      const end = html.indexOf(">", match.index + match[0].length);
      if (end < 0) continue;
      const at = end + 1;
      return html.slice(0, at) + tag + html.slice(at);
    }
  }
  return tag + html;
}
