/**
 * Where a scaffolded project's canvas resolution lives besides the composition
 * root's own `data-width`/`data-height`: the inline `html, body { width;
 * height }` CSS block and the `<meta name="viewport">` `content` attribute.
 * `@hyperframes/cli`'s `applyResolutionPreset` rewrites those same two places
 * when a project scaffolds with `--resolution`, but keeps its own
 * prefix-capturing regexes for that replace — these are a separate read-only
 * definition of the same locations, not the literal patterns it uses.
 *
 * Lives in `@hyperframes/parsers` rather than `@hyperframes/cli` because
 * `@hyperframes/lint` cannot depend on `cli` (`cli` depends on `lint`, not the
 * reverse), and `parsers` is a dependency both already share.
 */

/** Matches `html, body { ...width: <n>px... height: <n>px... }`. */
export const HTML_BODY_CSS_WIDTH_FIRST_RE =
  /html\s*,\s*body\s*\{[^}]*?width:\s*(\d+)px[^}]*?height:\s*(\d+)px/i;

/** Matches the same block with height authored before width. */
export const HTML_BODY_CSS_HEIGHT_FIRST_RE =
  /html\s*,\s*body\s*\{[^}]*?height:\s*(\d+)px[^}]*?width:\s*(\d+)px/i;

/** Matches `<meta ... name="viewport" ... content="width=<n>, height=<n>">`. */
export const VIEWPORT_META_SIZE_RE =
  /<meta[^>]*name=["']viewport["'][^>]*content=["']width=(\d+),\s*height=(\d+)/i;
