import { headContentStart } from "@hyperframes/core/compiler/html-document";

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
  // Placed where a browser's tokenizer starts the head, never at the text "<head": that text can sit
  // in an attribute value or a comment. To reproduce: `<html data-x='a <head> b'>` previewed with
  // `?variables={"a":"\" b=\""}` must give one script in <head> and leave <html>'s attributes alone.
  const at = headContentStart(html);
  return html.slice(0, at) + tag + html.slice(at);
}
