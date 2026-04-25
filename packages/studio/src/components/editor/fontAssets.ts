export interface ImportedFontAsset {
  family: string;
  path: string;
  url: string;
}

const FONT_EXT_RE = /\.(eot|otf|ttc|ttf|woff2?)$/i;
const FONT_STYLE_SUFFIX_RE =
  /\s+(thin|extralight|extra light|light|regular|roman|medium|semibold|semi bold|bold|extrabold|extra bold|black|italic|oblique|variable)$/i;

export function cssString(value: string): string {
  return JSON.stringify(value);
}

export function fontFamilyFromAssetPath(path: string): string {
  const fileName = decodeURIComponent(path.split(/[\\/]/).pop() ?? path).replace(FONT_EXT_RE, "");
  let family = fileName
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

  while (FONT_STYLE_SUFFIX_RE.test(family)) {
    family = family.replace(FONT_STYLE_SUFFIX_RE, "").trim();
  }

  return family || fileName;
}

export function importedFontFaceCss(asset: ImportedFontAsset, url: string = asset.url): string {
  return `@font-face { font-family: ${cssString(asset.family)}; src: url(${cssString(url)}); font-display: swap; }`;
}
