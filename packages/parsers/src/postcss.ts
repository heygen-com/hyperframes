// The one postcss parse for project CSS: a sourceMappingURL comment in it never makes postcss open the path it names.
import postcss, { type Root } from "postcss";

export function parseCss(css: string): Root {
  return postcss.parse(css, { map: false });
}
