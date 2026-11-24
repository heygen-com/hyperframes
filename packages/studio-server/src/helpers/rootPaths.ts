import { mapStartTagsAndStyles } from "@hyperframes/core/compiler/html-document";

const ROOT_PATH = /^\/(?!\/)/;
const PATH_ATTR =
  /(\s(?:src|href|poster|xlink:href)\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
const CSS_ROOT_URL = /(\burl\(\s*)(["']?)(\/(?!\/)[^"')\s]*)\2/gi;

const projectRelative = (path: string, base: string) =>
  ROOT_PATH.test(path) && path !== "/" && !path.startsWith(base) ? path.slice(1) : path;

export const underBase = (path: string, base: string) => {
  const relative = projectRelative(path, base);
  return relative === path ? path : base + relative;
};

/** Root paths in src, href, poster and CSS url() as project-relative paths, which the page's <base> resolves like
 * render; Studio reads them back as authored. Links and <base> stay. */
export function withRootPathsRelative(html: string, base: string): string {
  const css = (text: string) =>
    text.replace(
      CSS_ROOT_URL,
      (_m, open: string, quote: string, path: string) =>
        `${open}${quote}${projectRelative(path, base)}${quote}`,
    );
  const attrs = (tag: string) =>
    tag.replace(PATH_ATTR, (whole, name: string, dq?: string, sq?: string, bare?: string) => {
      const path = (dq ?? sq ?? bare ?? "").trim();
      const moved = projectRelative(path, base);
      if (moved === path) return whole;
      return dq !== undefined
        ? `${name}"${moved}"`
        : sq !== undefined
          ? `${name}'${moved}'`
          : `${name}${moved}`;
    });
  return mapStartTagsAndStyles(html, {
    tag: (tag) => (/^<(?:a|base)[\s/>]/i.test(tag) ? tag : css(attrs(tag))),
    style: css,
  });
}
