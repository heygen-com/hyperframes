import { describe, it, expect } from "vitest";
import { stripCssComments, stripJsComments, stripJsStringLiterals } from "./utils.js";

const scan = (src: string) => stripJsStringLiterals(stripJsComments(src));
const findsRaf = (src: string) => /requestAnimationFrame\s*\(/.test(scan(src));

describe("stripJsStringLiterals", () => {
  it("blanks a call the composition only renders as text", () => {
    expect(findsRaf('const CODE = "requestAnimationFrame(step);";')).toBe(false);
    expect(findsRaf("const CODE = `requestAnimationFrame(${fn});`;")).toBe(false);
  });

  it("keeps a call in a template interpolation, which is code", () => {
    expect(findsRaf("const label = `frame ${requestAnimationFrame(cb)}`;")).toBe(true);
  });

  // A regex literal's own quotes must not open a phantom string: `/[^a-z']/g` ships in
  // registry/components, and blanking its tail hid every later call in the script.
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

  // Whitespace must end the trailing identifier: fusing `flag` + `return` across a
  // newline read the regex as a division, and two such regexes balance the quote so
  // the mid-literal fallback never fires — an unbounded blanked span.
  it.each([
    "function a(s) {\n  let ok = flag\n  return /'/.test(s)\n}\n",
    "for (const x of /'/.source) {}\n",
  ])("keeps a call bracketed by two quote-bearing regexes after %j", (prefix) => {
    expect(findsRaf(`${prefix}requestAnimationFrame(step);\n${prefix}`)).toBe(true);
  });

  // Damage from a mis-read regex is line-bounded, so the call must sit on the SAME
  // line to pin it. A reserved word used as a property name is not keyword position.
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

  it("falls back to the source when the scan ends mid-literal", () => {
    // The trailing backslash escapes the closing quote, so the string runs to EOF.
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
  // Re-scanning the accumulated output per candidate slash was quadratic: a composition
  // with one inlined vendor bundle linted 58x slower.
  it("stays linear in slash-dense input", () => {
    // Min of three: a single sample picks up GC and CI contention, which can both
    // inflate `small` (hiding a regression) and inflate `large` (failing spuriously).
    const time = (n: number) => {
      const src = "a=b/c;".repeat(n);
      let best = Infinity;
      for (let run = 0; run < 3; run += 1) {
        const started = performance.now();
        stripJsStringLiterals(src);
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };
    const small = Math.max(time(20_000), 0.5);
    const large = time(160_000);
    // 8x the input; quadratic would be ~64x. Generous headroom for a noisy CI box.
    expect(large / small).toBeLessThan(24);
    // Absolute ceiling too: a noise-inflated `small` can hide a quadratic regression.
    expect(large).toBeLessThan(400);
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
