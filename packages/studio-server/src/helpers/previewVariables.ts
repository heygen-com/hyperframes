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
  // Never search for the text "<head": it can also sit inside an attribute
  // value or a comment (`<html data-x='a <head> b'>`, `<!-- <head> -->`), and a
  // tag placed there is not a script. To reproduce: preview a composition whose
  // <html> has such an attribute with `?variables={"a":"\" b=\""}`; the tag must
  // be a child of <head> and <html> must keep exactly its own attributes.
  const at = headContentStart(html);
  return html.slice(0, at) + tag + html.slice(at);
}
