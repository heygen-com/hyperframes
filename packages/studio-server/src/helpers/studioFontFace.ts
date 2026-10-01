const FONT_STYLE_RE = /<style\b[^>]*data-hf-studio-fonts=(["'])true\1[^>]*>([\s\S]*?)<\/style>/i;

// Braces only inside quoted strings; `<` nowhere, since `</style` ends the block whatever the quoting.
const ONE_FONT_FACE_RULE =
  /^@font-face \{(?:[^{}<"'\\]|"(?:[^"\\<\n]|\\[^<\n])*"|'(?:[^'\\<\n]|\\[^<\n])*')*\}$/;

export function isStudioFontFaceCss(css: unknown): css is string {
  return typeof css === "string" && ONE_FONT_FACE_RULE.test(css);
}

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
