import { describe, it, expect } from "vitest";
import {
  parseHtmlStructure,
  stripCssComments,
  stripJsComments,
  stripJsStringLiterals,
} from "./utils.js";

const scan = (src: string) => stripJsStringLiterals(stripJsComments(src));
const findsRaf = (src: string) => /requestAnimationFrame\s*\(/.test(scan(src));

describe("parseHtmlStructure source ranges", () => {
  it("does not include ignored markup inside a preceding malformed closing tag", () => {
    const source = "<p>x</p ignored<noise><span>y</span>";
    const tags = parseHtmlStructure(source).tags;
    expect(tags[1]).toMatchObject({ name: "span", raw: "<span>", attrs: "", index: 22 });
  });

  it("keeps a less-than inside a malformed tag name in the original source range", () => {
    const tags = parseHtmlStructure("<div<foo>body</div<foo>").tags;
    expect(tags.map(({ name, raw, attrs, index }) => ({ name, raw, attrs, index }))).toEqual([
      { name: "div<foo", raw: "<div<foo>", attrs: "", index: 0 },
    ]);
  });

  it("uses the original name boundary when Unicode lowercasing changes its length", () => {
    const source = '<Aİİİ data-check="<" data-flag=x>body</Aİİİ>';
    const tags = parseHtmlStructure(source).tags;
    expect(tags.map(({ name, raw, attrs, index }) => ({ name, raw, attrs, index }))).toEqual([
      {
        name: "ai̇i̇i̇",
        raw: '<Aİİİ data-check="<" data-flag=x>',
        attrs: ' data-check="<" data-flag=x',
        index: 0,
      },
    ]);
  });

  it("keeps malformed names and quoted less-than values after a multiline close", () => {
    const source = '<p>x</p\n  ><div<foo data-expr="a < b">y</div<foo>';
    const tags = parseHtmlStructure(source).tags;
    expect(tags[1]).toMatchObject({
      name: "div<foo",
      raw: '<div<foo data-expr="a < b">',
      attrs: ' data-expr="a < b"',
      index: 11,
    });
  });

  it("does not reuse implied-open origins for the following explicit tag", () => {
    const source = '</p></br><Aİ data-expr="x < y">text</Aİ>';
    const tags = parseHtmlStructure(source).tags;
    expect(tags.map(({ name, raw, attrs, index }) => ({ name, raw, attrs, index }))).toEqual([
      { name: "p", raw: "</p>", attrs: "p", index: 0 },
      { name: "br", raw: "</br>", attrs: "r", index: 4 },
      { name: "ai̇", raw: '<Aİ data-expr="x < y">', attrs: ' data-expr="x < y"', index: 9 },
    ]);
  });

  it("does not use apparent tags in comments or raw-text scripts as an opening origin", () => {
    const source = '<!-- <fake> --><script>const text = "<fake>";</script\n ><div<foo>x</div<foo>';
    const tags = parseHtmlStructure(source).tags;
    expect(tags.map(({ name, raw, attrs }) => ({ name, raw, attrs }))).toEqual([
      { name: "script", raw: "<script>", attrs: "" },
      { name: "div<foo", raw: "<div<foo>", attrs: "" },
    ]);
  });

  it("starts each open tag at its own < after a multiline closing tag", () => {
    const source = `<span data-expr="x < y">A</span\n    ><span>B</span>`;
    const tags = parseHtmlStructure(source).tags;
    expect(tags.map(({ raw, index }) => ({ raw, index }))).toEqual([
      { raw: `<span data-expr="x < y">`, index: 0 },
      { raw: `<span>`, index: source.indexOf("<span>") },
    ]);
  });
});

describe("stripJsStringLiterals", () => {
  it("blanks a call the composition only renders as text", () => {
    expect(findsRaf('const CODE = "requestAnimationFrame(step);";')).toBe(false);
    expect(findsRaf("const CODE = `requestAnimationFrame(${fn});`;")).toBe(false);
  });

  it("keeps a call in a template interpolation, which is code", () => {
    expect(findsRaf("const label = `frame ${requestAnimationFrame(cb)}`;")).toBe(true);
  });

  it.each([
    "const re = /[\"']/g;",
    "const re = /'/;",
    "const re = /[`]/;",
    "const r = s.split(/['\"]/);",
    'const r = s.replace(/[^a-z\']/g, "");',
    "if (a) { } /'/.test(x);",
    "const a = b / c / d;",
    "const p = i++ / total;",
    "const q = --i / total;",
  ])("does not let %j blank the rest of the script", (prefix) => {
    expect(findsRaf(`${prefix}\nrequestAnimationFrame(step);`)).toBe(true);
  });

  it.each([
    "function a(s) {\n  let ok = flag\n  return /'/.test(s)\n}\n",
    "for (const x of /'/.source) {}\n",
  ])("keeps a call bracketed by two quote-bearing regexes after %j", (prefix) => {
    expect(findsRaf(`${prefix}requestAnimationFrame(step);\n${prefix}`)).toBe(true);
  });

  it.each([
    "const clip = { in: 0.5, out: 5.5 }; const r = clip.in / clip.out;",
    "const r = data.new / 2;",
    "const r = list.of / 2;",
    "const r = sw.case / 2;",
    "const r = o?.in / 2;",
    "const p = i++ / total;",
    "const q = --i / total;",
  ])("finds a call on the same line as %j", (prefix) => {
    expect(findsRaf(`${prefix} requestAnimationFrame(step);`)).toBe(true);
  });

  it.each([
    "foo(/abc\nrequestAnimationFrame(step);",
    "var of = 2;\nvar r = of /2;\nrequestAnimationFrame(step);",
    "var q = 1;\nx = /a\\\nrequestAnimationFrame(step);",
  ])("falls back to the source when a slash never closes on its line: %j", (src) => {
    expect(scan(src)).toBe(src);
    expect(findsRaf(src)).toBe(true);
  });

  it("falls back to the source when a backslash ends a mis-read regex line", () => {
    const src = "var a = b in /x\\\n y = 'requestAnimationFrame(' / z /;";
    expect(scan(src)).toBe(src);
    expect(findsRaf(src)).toBe(true);
  });

  it("falls back to the source when the scan ends mid-literal", () => {
    const src = 'const p = "C:\\Users\\demo\\";\nrequestAnimationFrame(step);';
    expect(scan(src)).toBe(src);
    expect(findsRaf(src)).toBe(true);
  });

  it("preserves length and newline positions", () => {
    for (const src of [
      'const a = "x\\\ny";\nrequestAnimationFrame(step);',
      "const t = `a\nb${x}c\nd`;",
      "const r = /a\\/b/g;\n",
    ]) {
      const out = scan(src);
      expect(out.length).toBe(src.length);
      expect([...out].filter((c) => c === "\n").length).toBe(
        [...src].filter((c) => c === "\n").length,
      );
    }
  });
});

describe("stripJsStringLiterals scaling", () => {
  // Guards the quadratic backtracking this scanner was rewritten to avoid:
  // deciding regex-versus-division by re-reading the accumulated output on
  // every candidate slash.
  //
  // Measured in CPU time, not wall time: `process.cpuUsage` counts only work
  // this process did, so time spent descheduled on a shared runner does not
  // count. Only the ratio is asserted; an absolute millisecond bound is a
  // claim about the hardware, and it is how this test failed on unrelated
  // pull requests. Inputs stay well under 100k characters: above that the
  // output string's growth adds its own cost and 8x input measures ~20x even
  // for the linear scan. Inside that range 8x input measures ~8x; a quadratic
  // scan measures 60x or more.
  it("stays linear in slash-dense input", { timeout: 30_000 }, () => {
    const cpuMs = (n: number) => {
      const src = "a=b/c;".repeat(n);
      stripJsStringLiterals(src); // warm up before the first sample
      let best = Infinity;
      for (let run = 0; run < 5; run += 1) {
        const started = process.cpuUsage();
        stripJsStringLiterals(src);
        const spent = process.cpuUsage(started);
        best = Math.min(best, (spent.user + spent.system) / 1000);
      }
      return best;
    };
    const small = cpuMs(10_000);
    const large = cpuMs(80_000);
    expect(large / small).toBeLessThan(24);
  });
});

describe("stripJsComments", () => {
  const strip = (src: string) => stripJsComments(src);

  it("keeps a regex literal that ends in an escaped slash from opening a comment", () => {
    const src = 'var proto = /^https?:\\/\\//; var el = document.querySelector("#hero");';
    expect(strip(src)).toBe(src);
  });

  it("still strips a real comment that follows a regex literal", () => {
    const src = "var proto = /^https?:\\/\\//; // trailing note\nvar x = 1;";
    const out = strip(src);
    expect(out).toContain("/^https?:\\/\\//;");
    expect(out).not.toContain("trailing note");
    expect(out).toHaveLength(src.length);
  });

  it("does not read a slash inside a string as a comment", () => {
    const src = 'var s = "a // b"; var t = 1;';
    expect(strip(src)).toBe(src);
  });

  it("falls back to the source when a slash never closes on its line", () => {
    const src = "var of = 2;\nvar r = of /2; // note\n";
    expect(strip(src)).toBe(src);
  });
});

describe("stripCssComments", () => {
  it("keeps a rule sandwiched between comment markers printed as content", () => {
    const css =
      '#o::before{content:"/*"}\n[data-composition-id="main" data-start="0"]{color:red}\n#c::after{content:"*/"}';
    const out = stripCssComments(css);
    expect(out.length).toBe(css.length);
    expect(out).toContain('data-composition-id="main" data-start="0"');
  });

  it("blanks a real comment and an unterminated one, keeping length", () => {
    for (const css of ["/* gone */#a{color:red}", "#a{color:red}/* open"]) {
      const out = stripCssComments(css);
      expect(out.length).toBe(css.length);
      expect(out).not.toContain("/*");
      expect(out).toContain("#a{color:red}");
    }
  });
});
