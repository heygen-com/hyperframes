/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from "vitest";
import { THEME_TOKENS, variableCssPropertiesForId, collidingCssName } from "./themeTokens";
import { applyVariableBindings } from "./applyVariableBindings";
import { getVariables, injectCompositionCssVariables } from "./getVariables";

describe("THEME_TOKENS", () => {
  it("is non-empty", () => {
    expect(THEME_TOKENS.size).toBeGreaterThan(0);
  });

  it("reserves the tokens compositions read from their host", () => {
    for (const token of ["accent", "brand", "accent-2", "bg", "fg", "surface", "muted"]) {
      expect(THEME_TOKENS.has(token)).toBe(true);
    }
  });

  it("does not reserve ordinary variable ids", () => {
    for (const id of ["swap_at", "title", "count", "flowSpeed"]) {
      expect(THEME_TOKENS.has(id)).toBe(false);
    }
  });

  it("stores bare names, so callers can name the token they would shadow", () => {
    for (const token of THEME_TOKENS) expect(token.startsWith("--")).toBe(false);
  });
});

describe("variableCssPropertiesForId", () => {
  it("gives a non-reserved id both the namespaced name and the legacy alias", () => {
    expect(variableCssPropertiesForId("swap_at")).toEqual({
      namespaced: "--hf-var-swap-at",
      legacy: "--swap-at",
    });
  });

  it("gives a reserved id the namespaced name only", () => {
    expect(variableCssPropertiesForId("accent")).toEqual({
      namespaced: "--hf-var-accent",
      legacy: null,
    });
  });

  it("slugifies the id, so a mixed-case id has ONE name", () => {
    // Case-folded, not camel-split: `accentColor` is `accentcolor`, never
    // `accent-color`. The slug shape is tokenSlug's contract, not this one.
    expect(variableCssPropertiesForId("accentColor")).toEqual({
      namespaced: "--hf-var-accentcolor",
      legacy: "--accentcolor",
    });
  });

  it("reserves a mixed-case theme-token id exactly as it reserves the bare one", () => {
    // The consequence of deriving the bare name verbatim: `Accent` would test
    // as un-reserved and be aliased to `--Accent` on the paths that skipped
    // the slug, while the compiler reserved it. Same id, two answers.
    expect(variableCssPropertiesForId("Accent")).toEqual(variableCssPropertiesForId("accent"));
    expect(variableCssPropertiesForId("Accent").legacy).toBeNull();
  });

  it("collidingCssName names the property define-if-absent must test", () => {
    expect(collidingCssName("accentColor")).toBe("--accentcolor");
    expect(collidingCssName("Accent")).toBe("--hf-var-accent");
  });
});

/**
 * The agreement gate. A composition author binds `var(--hf-var-<slug>)`; that
 * only works if every site that injects the variable derives the SAME
 * property name from the id. These drove different derivations once (the
 * runtime bindings path used the id verbatim, everything else slugified), so
 * a mixed-case id silently produced two properties and the binding could only
 * match one.
 *
 * The compiler leg is pinned in packages/core/src/compiler/htmlBundler.test.ts
 * and the SDK's two writers in packages/sdk/src/session.variabledecls.test.ts,
 * against these same ids. (They cannot run here: this file is jsdom, and
 * importing the bundler drags in esbuild, which refuses to load under it.)
 */
describe("every injection path derives one property name per id", () => {
  const MIXED = "accentColor"; // non-reserved, mixed case
  const RESERVED = "Accent"; // slugs onto a theme token, mixed case
  const EXPECTED = "--hf-var-accentcolor";
  const EXPECTED_RESERVED = "--hf-var-accent";

  const DECLS = JSON.stringify([
    { id: MIXED, type: "color", label: "Accent colour", default: "#00c3ff" },
    { id: RESERVED, type: "color", label: "Accent", default: "#7c3aed" },
  ]);

  afterEach(() => {
    delete (window as Window & { __hfVariables?: unknown; __hyperframes?: unknown }).__hfVariables;
    delete (window as Window & { __hyperframes?: unknown }).__hyperframes;
    document.documentElement.removeAttribute("data-composition-variables");
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("applyVariableBindings (runtime, resolved values)", () => {
    (window as Window & { __hyperframes?: unknown }).__hyperframes = { getVariables };
    document.documentElement.setAttribute("data-composition-variables", DECLS);
    document.body.innerHTML = `<div id="root" data-hf-root></div>`;
    applyVariableBindings(document);

    const style = document.getElementById("root")?.style;
    expect(style?.getPropertyValue(EXPECTED)).toBe("#00c3ff");
    expect(style?.getPropertyValue("--hf-var-accentColor")).toBe("");
    expect(style?.getPropertyValue(EXPECTED_RESERVED)).toBe("#7c3aed");
    // Reserved on this path too: the host's --accent stays the host's.
    expect(style?.getPropertyValue("--accent")).toBe("");
    expect(style?.getPropertyValue("--Accent")).toBe("");
  });

  it("injectCompositionCssVariables (runtime, declared defaults)", () => {
    document.body.innerHTML = `<div id="decl" data-composition-variables='${DECLS}'></div>`;
    injectCompositionCssVariables(document);

    const style = (document.getElementById("decl") as HTMLElement).style;
    expect(style.getPropertyValue(EXPECTED)).toBe("#00c3ff");
    expect(style.getPropertyValue("--hf-var-accentColor")).toBe("");
    expect(style.getPropertyValue(EXPECTED_RESERVED)).toBe("#7c3aed");
    expect(style.getPropertyValue("--accent")).toBe("");
  });
});
