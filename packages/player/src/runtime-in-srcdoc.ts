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

type OpeningTag = { index: number; end: number };
const OPENING_TAG_BOUNDARIES = new Set<string | undefined>([">", " ", "\t", "\n", "\r", "\f"]);

/** Find an opening tag in one linear pass, without a backtracking regex over caller-owned HTML. */
function findOpeningTag(html: string, tagName: string): OpeningTag | null {
  const lower = html.toLowerCase();
  const prefix = `<${tagName}`;
  let from = 0;
  while (from < lower.length) {
    const index = lower.indexOf(prefix, from);
    if (index < 0) return null;
    const boundary = lower[index + prefix.length];
    if (OPENING_TAG_BOUNDARIES.has(boundary)) {
      const close = lower.indexOf(">", index + prefix.length);
      if (close < 0) return null;
      return { index, end: close + 1 };
    }
    from = index + prefix.length;
  }
  return null;
}

export function ensureRuntimeBeforeBodyScripts(html: string, runtimeUrl: string): string {
  if (!html || alreadyHasRuntime(html, runtimeUrl)) return html;

  const tag = `<script src="${runtimeUrl}"></script>`;
  const head = findOpeningTag(html, "head");
  if (head) {
    return html.slice(0, head.end) + tag + html.slice(head.end);
  }
  // No head: get in before <body> so body scripts still see the runtime. A
  // fragment with neither lands at the front, which is the same guarantee.
  const body = findOpeningTag(html, "body");
  if (body) return html.slice(0, body.index) + tag + html.slice(body.index);
  const htmlTag = findOpeningTag(html, "html");
  if (htmlTag) {
    return html.slice(0, htmlTag.end) + tag + html.slice(htmlTag.end);
  }
  return tag + html;
}
