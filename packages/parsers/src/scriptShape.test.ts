import { describe, expect, it } from "vitest";
import { scriptShape } from "./scriptShape";

const same = (a: string, b: string, maskNumbers = false) =>
  scriptShape(a, maskNumbers) === scriptShape(b, maskNumbers);

describe("scriptShape", () => {
  it("matches a script to esbuild's re-print of it", () => {
    const written = `// cards
const tl = gsap.timeline({ paused: true, })
const each = i => tl.to('#c' + i, { x: 1.0, y: (10), }, i * .5) /* in */
if (a) { each(1) }
const w = { x: window.innerWidth - 40 }
`;
    // Verbatim output of esbuild transformSync (loader js, legalComments none), as the preview bundler prints it.
    const printed =
      'const tl = gsap.timeline({ paused: true });\nconst each = (i) => tl.to("#c" + i, { x: 1, y: 10 }, i * 0.5);\nif (a) {\n  each(1);\n}\nconst w = { x: window.innerWidth - 40 };';
    expect(same(written, printed)).toBe(true);
  });

  it.each([
    ["an operator", `x = w - 40`, `x = w + 40`],
    ["a comparison", `a === b`, `a !== b`],
    ["a compound assignment", `a += 1`, `a -= 1`],
    ["a unary operator", `f(!a)`, `f(~a)`],
    ["a regular expression", `s.replace(/a/g, "")`, `s.replace(/b/i, "")`],
    ["a private name", `class A { #p = 1 }`, `class A { #q = 1 }`],
    ["an array hole", `f([1, , 2])`, `f([1, 2])`],
    ["a comma that joins two calls", `if (c) f(), g()`, `if (c) f(); g()`],
    ["a semicolon that splits a call", `a;\n(b)`, `a\n(b)`],
    ["a tagged template's raw text", "String.raw`p\\nq`", "String.raw`p\nq`"],
    ["a prototype written as a key", `({ __proto__: __proto__ })`, `({ __proto__ })`],
  ])("tells scripts apart that differ only in %s", (_name, a, b) => {
    expect(same(a, b)).toBe(false);
  });

  it("hides numbers only when asked", () => {
    expect(same(`tl.to("#a", {}, 1)`, `tl.to("#a", {}, 2)`)).toBe(false);
    expect(same(`tl.to("#a", {}, 1)`, `tl.to("#a", {}, 2)`, true)).toBe(true);
  });

  it("is null for a script that does not parse", () => {
    expect(scriptShape("tl.to(")).toBeNull();
  });
});
