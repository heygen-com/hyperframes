import { describe, expect, it } from "bun:test";
import {
  findUnsupportedCssText,
  findUnsupportedElements,
  gifFrames,
  imageVerdict,
} from "./ownClock.js";
import type { DomSnapshotLike } from "./overlayFingerprint.js";

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));
const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u32le = (n: number) => u32be(n).reverse();
const bytes = (list: number[] | string) =>
  new Uint8Array(typeof list === "string" ? Buffer.from(list) : list);

function gif(frames: number): number[] {
  const header = [...ascii("GIF89a"), 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255];
  const frame = [
    ...[0x21, 0xf9, 4, 0, 10, 0, 0, 0],
    ...[0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0],
    ...[2, 2, 0x4c, 0x01, 0],
  ];
  return [...header, ...Array.from({ length: frames }, () => frame).flat(), 0x3b];
}

function pngChunk(type: string, data: number[]): number[] {
  return [...u32be(data.length), ...ascii(type), ...data, 0, 0, 0, 0];
}

function png(actlFrames?: number): number[] {
  return [
    ...[0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a],
    ...pngChunk("IHDR", [...u32be(1), ...u32be(1), 8, 6, 0, 0, 0]),
    ...(actlFrames === undefined ? [] : pngChunk("acTL", [...u32be(actlFrames), ...u32be(0)])),
    ...pngChunk("IDAT", []),
    ...pngChunk("IEND", []),
  ];
}

function webp(animated: boolean): number[] {
  const chunk = animated
    ? [...ascii("VP8X"), ...u32le(10), 0x12, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    : [...ascii("VP8 "), ...u32le(2), 0, 0];
  return [...ascii("RIFF"), ...u32le(4 + chunk.length), ...ascii("WEBP"), ...chunk];
}

function ftyp(major: string, compatible: string[]): number[] {
  const body = [...ascii(major), 0, 0, 0, 0, ...compatible.flatMap(ascii)];
  return [...u32be(8 + body.length), ...ascii("ftyp"), ...body];
}

describe("imageVerdict", () => {
  it.each([
    ["animated GIF", gif(2), "an animated GIF"],
    ["APNG", png(2), "an APNG"],
    ["animated WebP", webp(true), "an animated WebP"],
    ["AVIF sequence", ftyp("avis", ["avif", "mif1", "msf1"]), "an image sequence"],
    [
      "SVG with SMIL",
      '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"><animate attributeName="r" to="8" dur="1s"/></circle></svg>',
      "an SVG that may animate or embed content",
    ],
    [
      "SVG with CSS animation",
      '<svg xmlns="http://www.w3.org/2000/svg"><style>@keyframes s{to{opacity:0}}</style></svg>',
      "an SVG that may animate or embed content",
    ],
    [
      "SVG embedding a data: GIF",
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/gif;base64,R0lG"/></svg>',
      "an SVG that may animate or embed content",
    ],
    ["truncated GIF", gif(1).slice(0, 20), "a GIF the passthrough cannot read"],
    ["unknown format", ascii("JXL?"), "an image of a format the passthrough does not read"],
  ])("declines an %s", (_name, data, verdict) => {
    expect(imageVerdict(bytes(data))).toBe(verdict);
  });

  it.each([
    ["static PNG", png()],
    ["single-frame APNG", png(1)],
    ["single-frame GIF", gif(1)],
    ["still WebP", webp(false)],
    ["still AVIF", ftyp("avif", ["mif1", "miaf"])],
    ["JPEG", [0xff, 0xd8, 0xff, 0xe0, 0, 0x10]],
    ["plain SVG", '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'],
  ])("accepts a %s", (_name, data) => {
    expect(imageVerdict(bytes(data))).toBeNull();
  });

  it("counts GIF frames to the trailer", () => {
    expect(gifFrames(bytes(gif(1)))).toBe(1);
    expect(gifFrames(bytes(gif(3)))).toBe(2);
    expect(gifFrames(bytes(gif(1).slice(0, -1)))).toBe(-1);
  });
});

describe("findUnsupportedCssText", () => {
  it.each([
    ["#sc::scroll-button(right){content:url(a.gif)}", "::scroll-button"],
    ["select::picker-icon{content:url(a.gif)}", "::picker-icon"],
    ["option::checkmark{content:url(a.gif)}", "::checkmark"],
    ["li::scroll-marker{content:url(a.gif)}", "::scroll-marker"],
    ["video::cue{color:red}", "::cue"],
    ["::view-transition-old(root){animation:none}", "::view-transition-old"],
    [".x{background:paint(ripple)}", "a paint() worklet image"],
  ])("declines %s", (css, finding) => {
    expect(findUnsupportedCssText(css)).toContain(finding);
  });

  it("accepts static pseudo-elements and ordinary rules", () => {
    expect(
      findUnsupportedCssText(
        ".cap::before{content:'>'} li::marker{color:red} ::selection{color:#fff} .p:hover{x:1} ::-webkit-scrollbar{display:none} .x{background:url(a.png)} .y{width:calc(1px + 2px)}",
      ),
    ).toBeNull();
  });
});

/** A one-document snapshot of `nodes` (name, pseudo type, inside a user-agent tree). */
function snapshot(
  nodes: Array<[name: string, pseudo?: string, userAgent?: boolean]>,
): DomSnapshotLike {
  const strings: string[] = [];
  const at = (text: string) => {
    const found = strings.indexOf(text);
    if (found >= 0) return found;
    strings.push(text);
    return strings.length - 1;
  };
  const pseudo = { index: [] as number[], value: [] as number[] };
  const shadow = { index: [] as number[], value: [] as number[] };
  nodes.forEach(([, type, ua], i) => {
    if (type) {
      pseudo.index.push(i);
      pseudo.value.push(at(type));
    }
    if (ua) {
      shadow.index.push(i);
      shadow.value.push(at("user-agent"));
    }
  });
  return {
    strings,
    documents: [
      {
        nodes: {
          nodeName: nodes.map(([name]) => at(name)),
          nodeType: nodes.map(() => 1),
          pseudoType: pseudo,
          shadowRootType: shadow,
        } as DomSnapshotLike["documents"][number]["nodes"],
      },
    ],
  };
}

describe("findUnsupportedElements", () => {
  it("accepts static HTML and SVG, the media gates' elements and static pseudo-elements", () => {
    expect(
      findUnsupportedElements(
        snapshot([
          ["HTML"],
          ["BODY"],
          ["DIV"],
          ["VIDEO"],
          ["AUDIO"],
          ["IMG"],
          ["SPAN"],
          ["svg"],
          ["linearGradient"],
          ["::before", "before"],
          ["::marker", "marker"],
          ["DIV", undefined, true],
        ]),
      ),
    ).toBeNull();
  });

  it.each([
    ["CANVAS", undefined, "1 <canvas>"],
    ["SELECT", undefined, "1 <select>"],
    ["INPUT", undefined, "1 <input>"],
    ["X-BADGE", undefined, "1 <x-badge>"],
    ["animate", undefined, "1 <animate>"],
    ["::picker-icon", "picker-icon", "1 ::picker-icon"],
    ["::scroll-marker", "scroll-marker", "1 ::scroll-marker"],
  ])("declines %s", (name, pseudo, detail) => {
    expect(findUnsupportedElements(snapshot([["DIV"], [name, pseudo]]))).toBe(detail);
  });
});
