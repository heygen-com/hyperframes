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
      "an SVG with a <style> element",
    ],
    [
      "a static <style>",
      `<svg ${SVG}><style>rect { fill: #f00 }</style><rect/></svg>`,
      "an SVG with a <style> element",
    ],
    [
      "a comment splitting animation inside <style>",
      `<svg ${SVG}><style>rect{anim<!---->ation:spin 1s infinite}@keyframes spin{to{fill:blue}}</style><rect/></svg>`,
      "an SVG with a <style> element",
    ],
    [
      "a comment splitting @keyframes inside an XHTML <style> in <metadata>",
      `<svg ${SVG} xmlns:h="http://www.w3.org/1999/xhtml"><metadata><h:style>rect{animation:s 1s infinite}@key<!---->frames s{to{fill:blue}}</h:style></metadata><rect/></svg>`,
      "an SVG with an element outside the SVG namespace",
    ],
    [
      "CDATA splitting animation",
      `<svg ${SVG}><g>anim<![CDATA[ation]]></g></svg>`,
      "an SVG with a CDATA section",
    ],
    [
      "an XHTML <style> under its default namespace in <metadata>",
      `<svg ${SVG}><metadata><style xmlns="http://www.w3.org/1999/xhtml">rect{animation:s 1s infinite}</style></metadata><rect/></svg>`,
      "an SVG with an element outside the SVG namespace",
    ],
    ["a comment", `<svg ${SVG}><!-- icon --><rect/></svg>`, "an SVG with a comment"],
    [
      "a static style attribute",
      `<svg ${SVG}><rect style="stroke:blue"/></svg>`,
      "an SVG with a style attribute",
    ],
    [
      "an animation in a style attribute",
      `<svg ${SVG}><rect style="animation-name:&#x73;"/></svg>`,
      "an SVG with a style attribute",
    ],
    [
      "an event handler",
      `<svg ${SVG}><rect onload="x()"/></svg>`,
      "an SVG with a onload attribute",
    ],
    [
      "an attribute in another namespace",
      `<svg ${SVG} xmlns:q="urn:q"><rect q:fill="red"/></svg>`,
      "an SVG with an attribute outside the static set (fill)",
    ],
    [
      "an escape in a presentation attribute",
      `<svg ${SVG}><rect fill="\\72 ed"/></svg>`,
      "an SVG with an escape in an attribute",
    ],
    [
      "a filter",
      `<svg ${SVG}><filter id="f"><feFlood/></filter></svg>`,
      "an SVG with a <filter> element",
    ],
    ["a link", `<svg ${SVG}><a href="#x"><rect/></a></svg>`, "an SVG with a <a> element"],
    [
      "editor metadata in another namespace",
      `<svg ${SVG}><metadata><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></metadata></svg>`,
      "an SVG with an element outside the SVG namespace",
    ],
    [
      "a DOCTYPE with an entity",
      `<!DOCTYPE svg [<!ENTITY a "animation">]><svg ${SVG}><rect/></svg>`,
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
      "a declaration, gradients and a local use",
      `<?xml version="1.0" encoding="UTF-8"?>\n<svg ${SVG} xmlns:xlink="http://www.w3.org/1999/xlink"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient><path id="p" d="M0 0h4"/></defs><use xlink:href="#p" fill="url(#g)"/></svg>`,
    ],
    [
      "text, references and metadata text",
      `<svg ${SVG}><metadata>made by hand</metadata><text x="1" y="3" font-size="2" xml:space="preserve">&#169; &amp; co</text></svg>`,
    ],
    ["a byte order mark", `﻿<svg ${SVG}><g/></svg>`],
  ])("accepts %s", (_name, text) => {
    expect(svgImageVerdict(text)).toBeNull();
  });
});
