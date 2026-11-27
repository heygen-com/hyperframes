import postcss, { type Root } from "postcss";

export function parseCss(css: string): Root {
  return postcss.parse(css, { map: false });
}
