// @vitest-environment node
import postcss from "postcss";
import { describe, expect, it, vi } from "vitest";
import { createCompositionCssScoper, scopeCssToComposition } from "./compositionScoping";

const scopeOf = (id: string) => `[data-composition-id="${id}"]`;

// Selector pieces that reach every branch of the scoping: root ids with and without timing
// attributes, document-level selectors, authored root ids, comments, nesting and global at-rules.
const piecesFor = (id: string) => [
  ".a",
  "#card-root",
  `[data-composition-id="${id}"]`,
  `[data-composition-id='${id}']`,
  `[data-composition-id^="${id}"]`,
  '[data-start="0"]',
  '[data-duration="2"]',
  `[data-start="[data-composition-id='${id}']"]`,
  "html",
  "body",
  ":root",
  "*",
  " ",
  " > ",
  ", ",
  "/* note */",
  ":hover",
  `[data-composition-id="${id}__hf2"]`,
  '[data-composition-id="hf-scope-placeholder"]',
  "&",
];
const WRAPPERS = [
  (rule: string) => rule,
  (rule: string) => `@media (min-width: 10px) { ${rule} }`,
  (rule: string) => `@keyframes k { from { opacity: 0; } } ${rule}`,
  (rule: string) => `.outer { ${rule} }`,
];

function randomSheets(id: string, count: number): string[] {
  const pieces = piecesFor(id);
  // mulberry32: a seeded generator whose low bits are as random as its high ones.
  let seed = 7;
  const next = (n: number) => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
  return Array.from({ length: count }, () => {
    const rules = Array.from({ length: 1 + next(4) }, () => {
      const selector = Array.from({ length: 1 + next(5) }, () => pieces[next(pieces.length)]);
      return WRAPPERS[next(WRAPPERS.length)]!(`${selector.join("")} { color: red; }`);
    });
    return rules.join("\n");
  });
}

const scopesFor = (id: string) => [
  scopeOf(`${id}__hf1`),
  scopeOf(`${id}__hf2`),
  scopeOf(id),
  scopeOf("other"),
  scopeOf("price$&tag"),
  '[data-composition-id="quote\\"d"]',
  "",
];

describe("createCompositionCssScoper", () => {
  it("scopes every sheet exactly as scopeCssToComposition does, whatever the mount's scope", () => {
    const scope = createCompositionCssScoper();
    for (const id of ["card", "c.a:rd", 'ca"rd', "ca]rd", "hf-scope-placeholder"]) {
      for (const css of randomSheets(id, 300)) {
        for (const compound of [false, true]) {
          for (const authoredRootId of [undefined, "card-root"]) {
            for (const selector of scopesFor(id)) {
              const options = { compoundAuthoredRoot: compound, scopeRootSelectors: true };
              expect(scope(css, id, selector, authoredRootId, options)).toBe(
                scopeCssToComposition(css, id, selector, authoredRootId, options),
              );
            }
          }
        }
      }
    }
  }, 30_000);

  it("parses a sheet once for all of its mounts", () => {
    const parse = vi.spyOn(postcss, "parse");
    const scope = createCompositionCssScoper();
    const css = `.title { color: var(--accent); } #card-root .row { background: url(a.png); }`;
    const scoped = [1, 2, 3, 4].map((n) =>
      scope(css, "card", scopeOf(`card__hf${n}`), "card-root"),
    );
    expect(parse).toHaveBeenCalledOnce();
    parse.mockRestore();
    scoped.forEach((out, i) => {
      expect(out).toBe(
        scopeCssToComposition(css, "card", scopeOf(`card__hf${i + 1}`), "card-root"),
      );
      expect(out).toContain(`${scopeOf(`card__hf${i + 1}`)} .title`);
    });
  });
});
