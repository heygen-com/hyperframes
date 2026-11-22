import { RUNTIME_BOOTSTRAP_ATTR } from "@hyperframes/core/compiler/html-tokens";

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
function alreadyHasRuntime(html: string, runtimeUrl: string | null): boolean {
  if (runtimeUrl && html.includes(runtimeUrl)) return true;
  // The engine inlines the runtime rather than linking it, and it assigns this global on the way in.
  return /__hyperframes\s*=(?!=)/.test(html) || linksRuntime(html);
}

/** A page that brings the runtime itself, which a sealed player then loads by `src` as before. */
export const carriesRuntime = (html: string): boolean => alreadyHasRuntime(html, null);

function linksRuntime(html: string): boolean {
  for (
    let tag = findOpeningTag(html, "script");
    tag;
    tag = findOpeningTag(html, "script", tag.end)
  ) {
    const text = html.slice(tag.index, tag.end);
    if (text.toLowerCase().includes(RUNTIME_BOOTSTRAP_ATTR)) return true;
    if (/\bsrc\s*=/i.test(text) && text.includes("hyperframe.runtime.iife.js")) return true;
  }
  return false;
}

type OpeningTag = { index: number; end: number };
const OPENING_TAG_BOUNDARIES = new Set<string | undefined>([">", " ", "\t", "\n", "\r", "\f"]);

/** Find an opening tag in one linear pass, without a backtracking regex over caller-owned HTML. */
function findOpeningTag(html: string, tagName: string, start = 0): OpeningTag | null {
  const lower = html.toLowerCase();
  const prefix = `<${tagName}`;
  let from = start;
  while (from < lower.length) {
    const index = lower.indexOf(prefix, from);
    if (index < 0) return null;
    const comment = lower.indexOf("<!--", from);
    if (comment >= 0 && comment < index) {
      const closed = lower.indexOf("-->", comment + 4);
      if (closed < 0) return null;
      from = closed + 3;
      continue;
    }
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
  return insertAtHeadStart(html, `<script src="${runtimeUrl}"></script>`);
}

/** The same placement with the runtime's own text, for a sealed frame: it then loads nothing from another origin. */
export function inlineRuntimeBeforeBodyScripts(html: string, escapedSource: string): string {
  if (!html || alreadyHasRuntime(html, null)) return html;
  return insertAtHeadStart(html, `<script>${escapedSource}</script>`);
}

/**
 * A document fetched from `url` and shown as srcdoc still resolves its relative paths there. The first
 * `<base href>` wins, so the page's own one is resolved against `url` and put first.
 */
export function withBaseHref(html: string, url: string): string {
  return insertAtHeadStart(html, `<base href="${escapeAttr(baseOf(html, url))}">`);
}

function baseOf(html: string, url: string): string {
  for (let tag = findOpeningTag(html, "base"); tag; tag = findOpeningTag(html, "base", tag.end)) {
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(
      html.slice(tag.index, tag.end),
    );
    if (!href) continue;
    try {
      return new URL(href[1] ?? href[2] ?? href[3] ?? "", url).href;
    } catch {
      return url;
    }
  }
  return url;
}

/** The bytes of a fetched page as the browser would read them: the response's charset, else the page's own. */
export function decodePage(bytes: ArrayBuffer, contentType: string | null): string {
  const declared =
    /charset=["']?([\w-]+)/i.exec(contentType ?? "")?.[1] ??
    /<meta[^>]{0,200}charset=["']?([\w-]+)/i.exec(
      new TextDecoder("latin1").decode(bytes.slice(0, 1024)),
    )?.[1];
  try {
    return new TextDecoder(declared ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

const escapeAttr = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function insertAtHeadStart(html: string, tag: string): string {
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
