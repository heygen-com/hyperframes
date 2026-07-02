/**
 * Sanitize a figma-exported SVG before it touches disk (design spec §5).
 *
 * Threat model: figma-SHAPED exports, hardened against the cheap adversarial
 * variants (nesting, unquoted attrs, scheme smuggling). This is a lexical
 * pass, not a general-purpose HTML sanitizer — content from arbitrary
 * untrusted sources should go through a real sanitizer (DOMPurify) instead.
 * Strips:
 *  - <script> elements (with content) and <style> blocks (@import exfil)
 *  - <foreignObject> subtrees (arbitrary embedded HTML)
 *  - on* event-handler attributes (quoted and unquoted)
 *  - href/xlink:href values unless local fragment (#id) or data:image/
 *
 * Keeps local fragment refs (#id) and data:image embeds, which figma uses
 * for clip paths and embedded rasters.
 */

/** Apply a replacement until the output stops changing (defeats nesting). */
function replaceStable(input: string, pattern: RegExp, replacement: string): string {
  let out = input;
  let prev;
  do {
    prev = out;
    out = out.replace(pattern, replacement);
  } while (out !== prev);
  return out;
}

export function sanitizeSvg(svg: string): string {
  let out = svg;
  out = replaceStable(out, /<script\b[\s\S]*?<\/script\b[^>]*>/gi, "");
  out = replaceStable(out, /<script\b[^>]*\/>/gi, "");
  out = replaceStable(out, /<style\b[\s\S]*?<\/style\b[^>]*>/gi, "");
  out = replaceStable(out, /<foreignObject\b[\s\S]*?<\/foreignObject\b[^>]*>/gi, "");
  out = replaceStable(out, /<foreignObject\b[^>]*\/>/gi, "");
  // Nesting leaves inert orphan close tags after the stable pass — drop them.
  out = out.replace(/<\/(?:script|style|foreignObject)\b[^>]*>/gi, "");
  // on* handler attributes: quoted and unquoted forms.
  out = replaceStable(out, /\son[a-z]+\s*=\s*"[^"]*"/gi, "");
  out = replaceStable(out, /\son[a-z]+\s*=\s*'[^']*'/gi, "");
  out = replaceStable(out, /\son[a-z]+\s*=\s*[^\s>'"]+/gi, "");
  // href-like attributes: POSITIVE allowlist — keep only local fragments and
  // data:image embeds; drop everything else (javascript:, https?:, blob:,
  // vbscript:, data:text/html, protocol-relative, …).
  // xmlns declarations are attribute *names*, not href values — untouched.
  out = out.replace(/\s(href|xlink:href)\s*=\s*"([^"]*)"/gi, (m, attr: string, value: string) =>
    isAllowedHref(value) ? m : "",
  );
  out = out.replace(/\s(href|xlink:href)\s*=\s*'([^']*)'/gi, (m, attr: string, value: string) =>
    isAllowedHref(value) ? m : "",
  );
  return out;
}

function isAllowedHref(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v.startsWith("#") || v.startsWith("data:image/");
}
