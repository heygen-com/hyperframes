/**
 * Put the runtime in the document's head, before anything in the body runs.
 *
 * The probe injects the runtime by appending a `<script src>` to an already
 * loaded document, and only once it has a reason to: a nested composition, or
 * five polls with a timeline present. Both are far too late for a COMPONENT.
 *
 * A component is markup pasted into a composition, and it reads its values in
 * an inline IIFE that runs while the body is being parsed:
 *
 *     var vars = window.__hyperframes && window.__hyperframes.getVariables
 *       ? window.__hyperframes.getVariables()
 *       : {};
 *
 * With the runtime arriving afterwards, that guard always took the empty
 * branch, so the component fell back to the defaults hardcoded in its own
 * script and every chosen value was ignored. On the catalog page that looked
 * like the customise panel doing nothing: badge-pop with count 10 and a green
 * accent rendered 3, in red.
 *
 * A classic external `<script src>` in `<head>` is parser-blocking, so moving
 * the same URL into the srcdoc fixes the ordering without changing what is
 * loaded. A CLI render never had this problem because the engine already puts
 * the runtime ahead of body scripts.
 */

/** Already carrying the runtime: a CLI-rendered page, or a second preparation. */
function alreadyHasRuntime(html: string, runtimeUrl: string): boolean {
  if (html.includes(runtimeUrl)) return true;
  // The engine inlines the runtime rather than linking it, and it defines this
  // global on the way in. Matching the source avoids a second, redundant copy.
  return /hyperframe\.runtime\.iife\.js|__hyperframes\s*=/.test(html);
}

export function ensureRuntimeBeforeBodyScripts(html: string, runtimeUrl: string): string {
  if (!html || alreadyHasRuntime(html, runtimeUrl)) return html;

  const tag = `<script src="${runtimeUrl}"></script>`;
  const head = /<head[^>]*>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  // No head: get in before <body> so body scripts still see the runtime. A
  // fragment with neither lands at the front, which is the same guarantee.
  const body = /<body[^>]*>/i.exec(html);
  if (body) return html.slice(0, body.index) + tag + html.slice(body.index);
  const htmlTag = /<html[^>]*>/i.exec(html);
  if (htmlTag) {
    const at = htmlTag.index + htmlTag[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  return tag + html;
}
