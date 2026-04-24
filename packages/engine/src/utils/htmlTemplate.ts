/**
 * linkedom follows browser semantics for <template>: its descendants live in a
 * DocumentFragment, so plain querySelectorAll() calls against the document do
 * not see media nested inside a top-level template wrapper. Sub-compositions
 * in HyperFrames commonly use a single top-level <template>, so unwrap one
 * level before parsing media from that HTML string.
 */
export function unwrapTemplate(html: string): string {
  const match = html.match(/<template[^>]*>([\s\S]*)<\/template>/i);
  return match && match[1] !== undefined ? match[1] : html;
}
