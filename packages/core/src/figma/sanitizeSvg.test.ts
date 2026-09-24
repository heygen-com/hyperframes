// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sanitizeSvg } from "./sanitizeSvg";

// Every payload below is drawn from the two adversarial-review reports against this file
// (hyperframes-4291-b7ace99b.md, hyperframes-4291-c9a5f8f3.md) plus the original hardening
// suite. Each must fail against the pre-rewrite regex sanitizer and pass against this one.
const HOSTILE_CASES: Array<[label: string, input: string, mustNotContain: string[]]> = [
  ["script element", `<svg><script>alert(1)</script><rect/></svg>`, ["<script", "alert(1)"]],
  ["self-closing script", `<svg><script src="//evil"/></svg>`, ["<script", "evil"]],
  ["style element (@import exfil)", `<svg><style>@import "//evil";</style></svg>`, ["evil"]],
  [
    "style element with external url()",
    `<svg><style>.a{fill:url(https://evil.example/x)}</style></svg>`,
    ["evil.example"],
  ],
  [
    "style element with javascript:",
    `<svg><style>.a{background:url('javascript:alert(1)')}</style></svg>`,
    ["javascript:"],
  ],
  [
    "style element with expression()",
    `<svg><style>.a{width:expression(alert(1))}</style></svg>`,
    ["expression("],
  ],
  [
    "CSS-escaped url() in style=",
    String.raw`<svg><rect style="fill:\75 rl(https://evil.example/b)"/></svg>`,
    ["evil.example"],
  ],
  [
    "CSS-escaped url() in a presentation attribute",
    String.raw`<svg><rect fill="\75rl(https://evil.example/b)"/></svg>`,
    ["evil.example"],
  ],
  [
    "CSS-escaped parens around a url in style=",
    String.raw`<svg><rect style="fill:url\28 https://evil.example/b\29 "/></svg>`,
    ["evil.example"],
  ],
  [
    "CSS-escaped url() in a style element",
    String.raw`<svg><style>.a{fill:\55 RL(https://evil.example/b)}</style></svg>`,
    ["evil.example"],
  ],
  [
    "CSS-escaped @import in a style element",
    String.raw`<svg><style>@\69mport 'https://evil.example/x.css';</style></svg>`,
    ["evil.example"],
  ],
  [
    "image-set() string URL in a style element (no url() at all)",
    `<svg><style>svg{background-image:image-set("https://evil.example/b" 1x)}</style></svg>`,
    ["evil.example"],
  ],
  [
    "CSS-escaped image-set() in style=",
    String.raw`<svg><rect style="background:\69mage-set('https://evil.example/b' 1x)"/></svg>`,
    ["evil.example"],
  ],
  [
    "foreignObject subtree",
    `<svg><foreignObject><body onload="alert(1)"/></foreignObject></svg>`,
    ["foreignObject", "onload"],
  ],
  ["self-closing foreignObject", `<svg><foreignObject/></svg>`, ["foreignObject"]],
  ["quoted on* handler", `<svg><rect onload="alert(1)"/></svg>`, ["onload"]],
  ["single-quoted on* handler", `<svg><rect onload='alert(1)'/></svg>`, ["onload"]],
  ["unquoted on* handler", `<svg><rect onload=alert(1)/></svg>`, ["onload", "alert"]],
  ["mixed-case on* handler", `<svg><rect ONCLICK='y'/></svg>`, ["ONCLICK", "onclick"]],
  [
    "quoted javascript: href",
    `<svg><a href="javascript:alert(1)"><rect/></a></svg>`,
    ["javascript:"],
  ],
  [
    "quoted javascript: xlink:href",
    `<svg><a xlink:href="javascript:alert(1)"/></svg>`,
    ["javascript:"],
  ],
  [
    "data:text/html href (not data:image/)",
    `<svg><a href="data:text/html,<script>1</script>">x</a></svg>`,
    ["data:text"],
  ],
  ["blob: href", `<svg><a href="blob:x">a</a></svg>`, ["blob:"]],
  ["protocol-relative href", `<svg><a href='//evil/x'>b</a></svg>`, ["evil"]],
  [
    "unquoted javascript: href",
    `<svg><a href=javascript:alert(1)><rect/></a></svg>`,
    ["javascript:"],
  ],
  [
    "unquoted external use href",
    `<svg><use href=https://evil.example/x.svg#p/></svg>`,
    ["evil.example"],
  ],
  [
    "style url() exfil",
    `<svg><rect style="fill:url(https://evil.example/x)"/></svg>`,
    ["evil.example"],
  ],
  [
    "style @import exfil",
    `<svg><rect style="background:@import url(evil)"/></svg>`,
    ["@import", "evil"],
  ],
  [
    "style expression() exfil",
    `<svg><rect style="width:expression(alert(1))"/></svg>`,
    ["expression("],
  ],
  [
    "style javascript: exfil",
    `<svg><rect style="background:url('javascript:alert(1)')"/></svg>`,
    ["javascript:"],
  ],
  [
    "href via a renamed xlink namespace prefix",
    `<svg xmlns:x="http://www.w3.org/1999/xlink"><use x:href="https://evil.example/x.svg#p"/></svg>`,
    ["evil.example"],
  ],
  [
    "fill url() exfil",
    `<svg><rect fill="url(https://evil.example/x.svg#p)"/></svg>`,
    ["evil.example"],
  ],
  [
    "filter url() exfil",
    `<svg><rect filter="url(https://evil.example/x.svg#f)"/></svg>`,
    ["evil.example"],
  ],
  [
    "mask url() exfil",
    `<svg><rect mask="url(https://evil.example/x.svg#m)"/></svg>`,
    ["evil.example"],
  ],
  [
    "clip-path url() exfil",
    `<svg><rect clip-path="url(https://evil.example/x.svg#c)"/></svg>`,
    ["evil.example"],
  ],
  [
    "marker-start url() exfil",
    `<svg><path marker-start="url(https://evil.example/x.svg#m)"/></svg>`,
    ["evil.example"],
  ],
  [
    "unquoted attribute value containing '='",
    `<svg><rect style=x=y;fill:url(https://evil.example/beacon)>r</rect></svg>`,
    ["evil.example"],
  ],
  [
    "SMIL <animate> rewrites href to javascript:",
    `<svg><a href="#a"><animate attributeName="href" to="javascript:alert(1)"/></a></svg>`,
    ["javascript:", "<animate", "attributeName"],
  ],
  [
    "SMIL <set> rewrites href to javascript:",
    `<svg><a href="#a"><set attributeName="href" to="javascript:alert(1)"/></a></svg>`,
    ["javascript:", "<set", "attributeName"],
  ],
  [
    "data:image/svg+xml href navigates when clicked on <a>",
    `<svg><a href="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+">click</a></svg>`,
    ["data:image"],
  ],
  [
    "unquoted self-closing slash swallow stays contained (no evil URL survives)",
    `<svg><use href=https://evil.example/x.svg#p/><rect width="10" height="10" fill="red"/></svg>`,
    ["evil.example"],
  ],
];

const LEGITIMATE_CASES: Array<[label: string, input: string, mustContain: string[]]> = [
  ["local fragment href", `<svg><use href="#localClip"/></svg>`, ['href="#localClip"']],
  [
    "data:image href kept off <a> (image fetch context, not a navigation)",
    `<svg><image href="data:image/png;base64,AAAA"/></svg>`,
    ["data:image/png;base64,AAAA"],
  ],
  ["xlink:href local fragment", `<svg><use xlink:href="#p"/></svg>`, ['href="#p"']],
  [
    "url(#id) on presentation attributes (clip-path, fill, marker-start)",
    `<svg><rect clip-path="url(#clip0)" fill="url(#grad)" marker-start="url(#arrow)"/></svg>`,
    ['clip-path="url(#clip0)"', 'fill="url(#grad)"', 'marker-start="url(#arrow)"'],
  ],
  ["benign style attribute", `<svg><rect style="fill:#123456"/></svg>`, ['style="fill:#123456"']],
  [
    "benign <style> block with class selectors survives (Illustrator-exported logos rely on this for fill color)",
    `<svg><style>.st0{fill:#5757F5;}</style><path class="st0" d="M1 1"/></svg>`,
    [".st0{fill:#5757F5;}", 'class="st0"'],
  ],
  [
    "compute-only CSS functions survive (real theSVG shapes: display-p3 color, transforms, @media)",
    `<svg><style>@media (prefers-color-scheme:dark){.a{fill:rgb(1,2,3)}}</style><path style="fill:#EBF0F0;fill:color(display-p3 0.92 0.94 0.94)" transform="matrix(1 0 0 1 2 3) skewX(4)" d="M1 1"/></svg>`,
    ["@media (prefers-color-scheme:dark)", "color(display-p3 0.92 0.94 0.94)", "skewX(4)"],
  ],
  [
    "case-sensitive SVG attributes/elements survive (viewBox, linearGradient)",
    `<svg viewBox="0 0 10 10" preserveAspectRatio="xMidYMid"><linearGradient id="g"/></svg>`,
    ['viewBox="0 0 10 10"', 'preserveAspectRatio="xMidYMid"', "<linearGradient"],
  ],
  [
    "sibling content after a malformed unquoted-href tag is not lost",
    `<svg><use href=https://evil.example/x.svg#p/><rect width="10" height="10" fill="red"/></svg>`,
    ['fill="red"'],
  ],
];

describe("sanitizeSvg: hostile input", () => {
  for (const [label, input, mustNotContain] of HOSTILE_CASES) {
    it(`drops: ${label}`, () => {
      const clean = sanitizeSvg(input);
      for (const needle of mustNotContain)
        expect(clean, `${label}: ${clean}`).not.toContain(needle);
    });
  }
});

describe("sanitizeSvg: legitimate content survives", () => {
  for (const [label, input, mustContain] of LEGITIMATE_CASES) {
    it(`keeps: ${label}`, () => {
      const clean = sanitizeSvg(input);
      for (const needle of mustContain) expect(clean, `${label}: ${clean}`).toContain(needle);
    });
  }

  it("a typical clean figma export keeps its structure and attributes", () => {
    const dirty = `<svg width="10" height="10" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10H0z" fill="#123456" clip-path="url(#clip0)"/><defs><clipPath id="clip0"><rect width="10" height="10"/></clipPath></defs></svg>`;
    const clean = sanitizeSvg(dirty);
    for (const needle of [
      'width="10"',
      'height="10"',
      'viewBox="0 0 10 10"',
      'd="M0 0h10v10H0z"',
      'fill="#123456"',
      'clip-path="url(#clip0)"',
      "<defs>",
      "<clipPath",
      "<rect",
    ]) {
      expect(clean).toContain(needle);
    }
  });
});

describe("sanitizeSvg: structural edge cases", () => {
  it("returns empty output for a document with no root element", () => {
    expect(sanitizeSvg("")).toBe("");
  });

  it("drops an entire element not on the allowlist, including its children", () => {
    const clean = sanitizeSvg(`<svg><customElement><rect fill="red"/></customElement></svg>`);
    expect(clean).not.toContain("customElement");
    expect(clean).not.toContain("fill");
  });

  it("drops nested script/foreignObject without leaving inner content", () => {
    const clean = sanitizeSvg(
      `<svg><foreignObject><foreignObject><iframe/></foreignObject></foreignObject></svg>`,
    );
    expect(clean).not.toContain("foreignObject");
    expect(clean).not.toContain("iframe");
  });
});

// Each took 8s+ under the earlier regex scans (cubic and quadratic backtracking); now ~3ms.
describe("sanitizeSvg: hostile input size", () => {
  const HUGE_CASES: Array<[label: string, input: string]> = [
    [
      "unclosed url( + 4k spaces in style=",
      `<svg><rect style="fill:url(${" ".repeat(4_000)}x"/></svg>`,
    ],
    [
      "100k-char word with no paren in <style>",
      `<svg><style>.a{fill:${"a".repeat(100_000)}}</style></svg>`,
    ],
  ];
  for (const [label, input] of HUGE_CASES) {
    it(`stays fast on ${label}`, () => {
      const started = performance.now();
      sanitizeSvg(input);
      expect(performance.now() - started).toBeLessThan(2_000);
    });
  }
});
