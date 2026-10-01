const FONT_STYLE_RE = /<style\b[^>]*data-hf-studio-fonts=(["'])true\1[^>]*>([\s\S]*?)<\/style>/i;

export function isStudioFontFaceCss(css: unknown): css is string {
  return typeof css === "string" && css.startsWith("@font-face {") && !css.includes("<");
}

/** Adds `css` to the file's Studio font block, creating the block in `<head>` the first time. */
export function ensureStudioFontFaceCss(html: string, css: string): string {
  if (html.includes(css)) return html;
  const block = FONT_STYLE_RE.exec(html);
  if (block) {
    const next = `${(block[2] ?? "").trim()}\n${css}`.trim();
    return html.replace(block[0], () => `<style data-hf-studio-fonts="true">\n${next}\n</style>`);
  }
  const styleTag = `<style data-hf-studio-fonts="true">\n${css}\n</style>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, () => `  ${styleTag}\n  </head>`);
  return `${styleTag}\n${html}`;
}
