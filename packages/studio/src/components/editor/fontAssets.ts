export interface ImportedFontAsset {
  family: string;
  path: string;
  url: string;
  /** The weights this file draws: "700" for a static file, "100 900" for a variable one. */
  weight?: string;
  style?: "normal" | "italic";
}

const FONT_EXT_RE = /\.(eot|otf|ttc|ttf|woff2?)$/i;
const FONT_STYLE_SUFFIX_RE =
  /\s+(thin|extralight|extra light|light|regular|roman|medium|semibold|semi bold|bold|extrabold|extra bold|black|italic|oblique|variable)$/i;

function cssString(value: string): string {
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

// A face with a weight or style lets several files of one family sit side by side, each drawing its own texts.
export function importedFontFaceCss(asset: ImportedFontAsset, url: string = asset.url): string {
  const weight =
    asset.weight && /^\d{1,4}( \d{1,4})?$/.test(asset.weight)
      ? ` font-weight: ${asset.weight};`
      : "";
  const style = asset.style
    ? ` font-style: ${asset.style === "italic" ? "italic" : "normal"};`
    : "";
  return `@font-face { font-family: ${cssString(asset.family)}; src: url(${cssString(url)});${weight}${style} font-display: swap; }`;
}
