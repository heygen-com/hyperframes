/**
 * Where a scaffolded project's canvas resolution lives besides the root's own
 * data-width/data-height: the html/body CSS size and the meta viewport content.
 */

/** html/body CSS, width first. Groups 1/3 are the surrounding text, 2/4 the digits. */
export const HTML_BODY_CSS_WIDTH_FIRST_RE =
  /(html\s*,\s*body\s*\{[^}]*?width:\s*)(\d+)px([^}]*?height:\s*)(\d+)px/i;

/** Same block, height authored first. */
export const HTML_BODY_CSS_HEIGHT_FIRST_RE =
  /(html\s*,\s*body\s*\{[^}]*?height:\s*)(\d+)px([^}]*?width:\s*)(\d+)px/i;

/** Viewport meta content. Shared by lint (reads groups 2/4) and cli (replaces via 1/3). */
export const VIEWPORT_META_SIZE_RE =
  /(<meta[^>]*name=["']viewport["'][^>]*content=["']width=)(\d+)(,\s*height=)(\d+)/i;
