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
  /**
   * Guards the quadratic backtracking this scanner was rewritten to avoid: deciding
   * regex-versus-division by re-reading the accumulated output on every candidate
   * slash, which a composition carrying one inlined vendor bundle turns into minutes.
   *
   * Measured in CPU time, not wall time. CI runners are shared, so wall time also
   * counts the milliseconds this process spent descheduled while a neighbour had the
   * core, and an absolute millisecond ceiling is then a claim about the runner rather
   * than about the algorithm — which is how this test failed on unrelated pull
   * requests. `process.cpuUsage` counts only work this process actually did. Measured
   * on a machine at load average 16, the wall-clock ratio for this same input reached
   * 45x while the CPU ratio stayed at 20x.
   *
   * Only the ratio is asserted; there is deliberately no absolute bound, because how
   * many milliseconds the scan costs is a property of the hardware and how many it
   * costs *relative to a smaller input* is the property of the code. The bound is
   * loose because the linear scan is not perfectly linear in measured cost: the
   * output string grows with the input, so V8's own string handling adds overhead,
   * and 8x input measures ~16-22x cost. A quadratic scan measures 60x or more.
   */
  it("stays linear in slash-dense input", () => {
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
    // Sized so the smaller sample costs several milliseconds of CPU — well clear of
    // the accounting granularity, so the ratio means something.
    const small = cpuMs(40_000);
    const large = cpuMs(320_000);
    expect(large / small).toBeLessThan(32);
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
