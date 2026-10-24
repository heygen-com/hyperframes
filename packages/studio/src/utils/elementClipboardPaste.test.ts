// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as paste from "./elementClipboardPaste";
const base = {
  html: '<section id="title"><h1>Editable <b>text</b></h1><svg viewBox="0 0 10 10"><path id="shape" d="M0 0L10 10"/></svg></section>',
  css: "body, :root, * {color:red} #title {background: blue} @media (min-width: 1px) { h1 { font-size: 24px } }",
  width: 320,
  height: 180,
  warnings: [],
};

describe("external element preparation", () => {
  it("preserves editable text and SVG, scopes all rules, and normalizes root geometry", () => {
    const result = paste.prepareElementClipboard(base, "element-1");
    const doc = new DOMParser().parseFromString(result.html, "text/html");
    expect(doc.querySelector("h1 b")?.textContent).toBe("text");
    expect(doc.querySelector("svg path")?.getAttribute("d")).toBe("M0 0L10 10");
    expect(doc.body.firstElementChild?.id).toBe("element-1");
    expect(result.html).toContain("width: 320px");
    expect(result.html).toContain("height: 180px");
    expect(result.html).toContain("position: absolute");
    expect(result.html).not.toContain("position: fixed");
    expect(result.html).toContain("#element-1 :is(");
    expect(result.html).not.toContain("#title");
  });
  it("normalizes the captured root position and dimensions without flattening it", () => {
    const result = paste.prepareElementClipboard(
      {
        ...base,
        html: '<section style="position:fixed;left:999px;top:888px;width:12px;height:13px"><h1>Text</h1></section>',
      },
      "element-1",
    );
    const el = new DOMParser().parseFromString(result.html, "text/html").querySelector("section")!;
    expect(el.style.position).toBe("relative");
    expect(el.style.left).toBe("0px");
    expect(el.style.top).toBe("0px");
    expect(el.style.width).toBe("320px");
    expect(el.style.height).toBe("180px");
  });
  it("removes active HTML, secrets, forms, custom elements and SMIL", () => {
    const html =
      '<div data-secret="token" data-auth="token" onclick="alert(1)"><script>alert(1)</script><iframe srcdoc="bad"></iframe><object data="https://bad"></object><input value="password"><x-evil>custom</x-evil><svg><a href="javascript:alert(1)"><text>Safe</text></a><animate attributeName="href" values="javascript:alert(1)"/><foreignObject><iframe/></foreignObject></svg><img src="https://bad" onerror="alert(1)"></div>';
    const result = paste.prepareElementClipboard({ ...base, html }, "element-1");
    expect(result.html).not.toMatch(
      /script|iframe|object|input|x-evil|animate|foreignObject|onclick|onerror|data-secret|data-auth|javascript:|https:\/\/bad/,
    );
    expect(result.html).toContain("Safe");
    expect(result.warnings.length).toBeGreaterThan(0);
  });
  it("rejects network CSS, escaped URLs, imports, global at-rules and injected style terminators", () => {
    const css =
      '@import "https://bad"; @font-face { font-family: Attack; src: url(https://bad) } @keyframes attack { to { opacity:0 } } body{background:u\\72l(https://bad)} h1{background-image:image-set("https://bad" 1x);color:blue} </style><script>alert(1)</script>';
    const result = paste.prepareElementClipboard(
      {
        ...base,
        css,
        html: '<div style="background:url(https://bad);position:fixed;color:red">Text</div>',
      },
      "element-1",
    );
    expect(result.html).not.toMatch(/https:|script|@import|@keyframes|image-set|position: fixed/);
  });
  it("namespaces duplicate IDs and fragment references across pastes", () => {
    const input = {
      ...base,
      html: '<svg><defs><linearGradient id="paint"/></defs><rect id="paint" fill="url(#paint)"/><use href="#paint"/></svg>',
      css: "#paint {stroke: red}",
    };
    const one = paste.prepareElementClipboard(input, "element-1");
    const two = paste.prepareElementClipboard(input, "element-2");
    expect(one.html).not.toMatch(/id="paint"|url\(#paint\)|href="#paint"/);
    expect(
      new DOMParser()
        .parseFromString(one.html, "text/html")
        .querySelector("rect")
        ?.getAttribute("fill"),
    ).toContain("element-1-node-");
    const ids = Array.from(
      new DOMParser().parseFromString(one.html + two.html, "text/html").querySelectorAll("[id]"),
      (el) => el.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("rejects malformed selectors that could escape the descendant scope", () => {
    const result = paste.prepareElementClipboard(
      { ...base, css: "h1), body, :is(h1 {color: red}" },
      "element-1",
    );
    expect(result.html).not.toContain("body");
  });
  it("uses isolated embedded fonts in inline styles and SVG presentation attributes", () => {
    const result = paste.prepareElementClipboard(
      {
        ...base,
        html: '<div class="font-root" style="font-family:Test"><svg><text font-family="Test">Text</text></svg></div>',
        css: '@font-face{font-family:Test;src:url("data:font/woff2;base64,d09GMg==")}',
      },
      "element-1",
    );
    const doc = new DOMParser().parseFromString(result.html, "text/html");
    expect(doc.querySelector(".font-root")?.getAttribute("style")).toContain("element-1-font-0");
    expect(doc.querySelector("text")?.getAttribute("font-family")).toContain("element-1-font-0");
  });
  it("keeps only numeric serializer node markers for computed CSS", () => {
    const result = paste.prepareElementClipboard(
      {
        ...base,
        html: '<div data-hf-n="0"><span data-hf-n="1" data-token="secret">Text</span><i data-hf-n="secret"/></div>',
        css: '[data-hf-n="1"]{color:red}',
      },
      "element-1",
    );
    const doc = new DOMParser().parseFromString(result.html, "text/html");
    expect(doc.querySelector("span")?.getAttribute("data-hf-n")).toBe("1");
    expect(result.html).not.toContain("secret");
  });
  it("removes selectors that fail browser selector parsing", () => {
    const result = paste.prepareElementClipboard(
      { ...base, css: "div > > span {color:red}" },
      "element-1",
    );
    expect(result.html).not.toContain("div > > span");
  });
  it("keeps button text editable without retaining submit behavior or form values", () => {
    const result = paste.prepareElementClipboard(
      {
        ...base,
        html: '<button type="submit" form="existing" value="secret" formaction="https://bad">Buy now</button>',
        css: "",
      },
      "element-1",
    );
    const button = new DOMParser()
      .parseFromString(result.html, "text/html")
      .querySelector("button");
    expect(button?.textContent).toBe("Buy now");
    expect(button?.getAttribute("type")).toBe("button");
    expect(result.html).not.toMatch(/secret|formaction|https:|form=/);
  });
  it("keeps embedded raster images and fonts while warning about removed resources", () => {
    const image = "data:image/png;base64,iVBORw0KGgo=";
    const result = paste.prepareElementClipboard(
      {
        ...base,
        html: `<div><img src="${image}"><img src="/missing.png"></div>`,
        css: '@font-face {font-family: Test;src:url("data:font/woff2;base64,d09GMg==")} h1 {font-family:Test}',
      },
      "element-1",
    );
    expect(result.html).toContain(image);
    expect(result.html).toContain("data:font/woff2;base64,d09GMg==");
    expect(result.html).not.toContain("/missing.png");
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

it("isolates mixed-case font faces and descriptors and remaps shorthand fonts", () => {
  const result = paste.prepareElementClipboard(
    {
      ...base,
      html: '<div class="font-root" style="font:16px Test">Text</div>',
      css: '@FONT-FACE{FONT-FAMILY:Test;src:url("data:font/woff2;base64,d09GMg==")} div{font:16px Test}',
    },
    "element-1",
  );
  const doc = new DOMParser().parseFromString(result.html, "text/html");
  expect(doc.querySelector("style")?.textContent).not.toMatch(/font-family:\s*Test/i);
  expect(doc.querySelector("style")?.textContent).toContain('font:16px "element-1-font-0"');
  expect(doc.querySelector(".font-root")?.getAttribute("style")).toContain("element-1-font-0");
});
