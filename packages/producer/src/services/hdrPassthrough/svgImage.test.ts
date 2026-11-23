import { describe, expect, it } from "bun:test";
import { svgImageVerdict } from "./svgImage.js";

const SVG = 'xmlns="http://www.w3.org/2000/svg"';

describe("svgImageVerdict", () => {
  it.each([
    [
      "namespace-prefixed SMIL",
      `<svg ${SVG} xmlns:s="http://www.w3.org/2000/svg"><rect fill="red"><s:animate attributeName="fill" values="red;blue" dur="1s" repeatCount="indefinite"/></rect></svg>`,
      "an SVG with a <animate> element",
    ],
    [
      "a character reference spelling animation in <style>",
      `<svg ${SVG}><style>rect{anim&#97;tion:spin 1s linear infinite} &#64;keyframes spin{to{fill:blue}}</style><rect/></svg>`,
      "an SVG whose CSS animates",
    ],
    [
      "a hex character reference spelling @keyframes",
      `<svg ${SVG}><style>&#x40;key&#x66;rames s{to{opacity:0}}</style></svg>`,
      "an SVG whose CSS animates",
    ],
    [
      "a CSS escape",
      `<svg ${SVG}><style>rect{anim\\61tion:spin 1s infinite}</style></svg>`,
      "an SVG whose CSS has an escape",
    ],
    [
      "an animation in CDATA",
      `<svg ${SVG}><style><![CDATA[rect{transition:fill 1s}]]></style></svg>`,
      "an SVG whose CSS animates",
    ],
    [
      "an animation in a style attribute",
      `<svg ${SVG}><rect style="animation-name:&#x73;"/></svg>`,
      "an SVG whose CSS animates",
    ],
    [
      "a DOCTYPE with an entity",
      `<!DOCTYPE svg [<!ENTITY a "animation">]><svg ${SVG}><style>rect{&a;:s 1s}</style></svg>`,
      "an SVG with a DOCTYPE or declaration",
    ],
    [
      "an undeclared entity",
      `<svg ${SVG}><text>&nbsp;</text></svg>`,
      "an SVG with an entity reference (&nbsp;)",
    ],
    [
      "plain SMIL",
      `<svg ${SVG}><set attributeName="x" to="1" begin="1s"/></svg>`,
      "an SVG with a <set> element",
    ],
    ["<discard>", `<svg ${SVG}><discard begin="1s"/></svg>`, "an SVG with a <discard> element"],
    [
      "an element name in another case",
      `<svg ${SVG}><Rect/></svg>`,
      "an SVG with a <Rect> element",
    ],
    [
      "SVG content under another default namespace",
      `<svg ${SVG}><g xmlns="urn:x"><animate/></g></svg>`,
      "an SVG with an element outside the SVG namespace",
    ],
    ["an unbound prefix", `<svg ${SVG}><q:animate/></svg>`, "an SVG with an unbound prefix (q)"],
    [
      "a stylesheet processing instruction",
      `<?xml-stylesheet href="a.css"?><svg ${SVG}/>`,
      "an SVG with a processing instruction",
    ],
    [
      "an embedded image",
      `<svg ${SVG}><image href="data:image/gif;base64,R0lG"/></svg>`,
      "an SVG with a <image> element",
    ],
    [
      "an external use",
      `<svg ${SVG} xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="other.svg#a"/></svg>`,
      "an SVG with an external reference",
    ],
    ["a root that is not SVG", `<g ${SVG}/>`, "an image of a format the passthrough does not read"],
    ["no SVG namespace", "<svg><rect/></svg>", "an SVG with an element outside the SVG namespace"],
    ["mismatched tags", `<svg ${SVG}><g></svg>`, "an SVG the passthrough cannot read"],
    ["a truncated document", `<svg ${SVG}><rect/>`, "an SVG the passthrough cannot read"],
  ])("declines %s", (_name, text, verdict) => {
    expect(svgImageVerdict(text)).toBe(verdict);
  });

  it.each([
    ["shapes", `<svg ${SVG} width="4" height="4"><rect width="4" height="4" fill="red"/></svg>`],
    [
      "a declaration, comments, gradients and a local use",
      `<?xml version="1.0" encoding="UTF-8"?>\n<!-- icon --><svg ${SVG} xmlns:xlink="http://www.w3.org/1999/xlink"><defs><linearGradient id="g"><stop offset="0"/></linearGradient><path id="p" d="M0 0h4"/></defs><use xlink:href="#p" fill="url(#g)"/></svg>`,
    ],
    [
      "static CSS and references",
      `<svg ${SVG}><style>rect { fill: #f00 } g &gt; rect { opacity: .5 }</style><text>&#169; &amp; co</text><rect style="stroke:blue"/></svg>`,
    ],
    [
      "editor metadata in another namespace",
      `<svg ${SVG}><metadata><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description/></rdf:RDF></metadata><circle r="2"/></svg>`,
    ],
    ["a byte order mark", `﻿<svg ${SVG}><g/></svg>`],
  ])("accepts %s", (_name, text) => {
    expect(svgImageVerdict(text)).toBeNull();
  });
});
