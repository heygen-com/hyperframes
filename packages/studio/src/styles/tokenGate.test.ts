/**
 * The token gate (R11, AE1).
 *
 * Tailwind has no strict mode for the classes it finds in markup: a class it
 * cannot compile is silently dropped, so `rounded-button` renders as no radius
 * at all and nothing anywhere goes red. This test closes that hole by asking
 * Tailwind itself. Studio's real entry stylesheet is compiled with every class
 * the source claims as the candidate list, and any candidate that produces no
 * selector is reported as `file: class`.
 *
 * Tailwind is the only judge, so there is no allowlist to maintain and nothing
 * to keep in step: static utilities, arbitrary values, tokens from `theme.css`
 * and Studio's own hand-written CSS rules all appear in the emitted sheet.
 *
 * A class that fails here is fixed by adding the token to `theme.css`, or by
 * changing the markup. It is never excused.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";
import { extractClassCandidates } from "./classCandidates";
import { listSourceFiles, loadStylesheet, STYLES_DIR } from "./styleSources";

/**
 * A class selector in the emitted CSS, with Tailwind's escapes removed, so
 * `.hover\:bg-surface\/50` reads back as the candidate that produced it.
 */
const CLASS_SELECTOR = /\.((?:\\.|[^\s.,{}()>+~:[\]#'"*/\\])+)/g;

/**
 * Tailwind's two variant markers. They are written in markup and carry a
 * variant name (`group/card`), but they produce no rule of their own, so no
 * compiled selector can ever vouch for them. Nothing else is exempt.
 */
const MARKERS = new Set(["group", "peer"]);

/**
 * `hf-` is HyperFrames' reserved prefix for its own semantic hooks. Those are
 * not utilities and carry no design value, so Tailwind is the wrong judge of
 * them: the gate covers Tailwind's namespace, and this one is Studio's.
 */
const HOOK_PREFIX = /^hf-/;

/** Compile Studio's stylesheet and return every class it can produce. */
async function resolvable(candidates: string[]): Promise<Set<string>> {
  const compiled = await compile(readFileSync(path.join(STYLES_DIR, "studio.css"), "utf8"), {
    base: STYLES_DIR,
    loadStylesheet,
  });
  const css = compiled.build(candidates);
  const selectors = new Set<string>();
  for (const [, selector] of css.matchAll(CLASS_SELECTOR)) {
    selectors.add(selector.replace(/\\(.)/g, "$1"));
  }
  return selectors;
}

/**
 * `file: class` for every class the sources claim that Tailwind cannot make.
 * Sources are passed in so the fixtures below exercise the same code path the
 * tree does.
 */
async function unresolved(sources: ReadonlyMap<string, string>): Promise<string[]> {
  const claims = new Map<string, string[]>();
  for (const [file, source] of sources) {
    for (const candidate of extractClassCandidates(source)) {
      const seen = claims.get(candidate.base);
      if (seen) seen.push(file);
      else claims.set(candidate.base, [file]);
    }
  }
  const produced = await resolvable([...claims.keys()]);
  const failures: string[] = [];
  for (const [candidate, files] of claims) {
    if (produced.has(candidate) || MARKERS.has(candidate.split("/")[0])) continue;
    if (HOOK_PREFIX.test(candidate)) continue;
    for (const file of files) failures.push(`${file}: ${candidate}`);
  }
  return failures.sort();
}

/**
 * Every file the gate reads. This mirrors the `@source` globs in `studio.css`,
 * so a class the gate accepts is a class Tailwind was given the chance to see.
 * Tests are excluded: a fixture in a test is not markup.
 */
function studioSources(): Map<string, string> {
  return listSourceFiles((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));
}

describe("token gate", () => {
  it("names the file and the class when a class resolves to nothing", async () => {
    // Covers AE1. `rounded-hologram` is shaped exactly like a token name and
    // is defined nowhere, which is the whole failure mode: it reads as real in
    // review and renders as nothing at runtime.
    const failures = await unresolved(
      new Map([["ui/Button.tsx", `const sizeStyles = { md: "h-8 rounded-hologram text-mega" };`]]),
    );

    expect(failures).toEqual(["ui/Button.tsx: rounded-hologram", "ui/Button.tsx: text-mega"]);
  });

  it("accepts an arbitrary value and reports it as one", async () => {
    const source = `<div className="text-[11px]" />`;

    expect(await unresolved(new Map([["a.tsx", source]]))).toEqual([]);
    expect(extractClassCandidates(source).filter((c) => c.arbitrary)).toHaveLength(1);
  });

  it("accepts variants, static utilities and Studio's own CSS classes", async () => {
    // `timeline-clip` is a plain rule in `studio.css`, not a utility.
    const source = `<div className="hover:bg-surface/50 text-center border-dashed timeline-clip" />`;

    expect(await unresolved(new Map([["a.tsx", source]]))).toEqual([]);
  });

  it("leaves Studio's own hook prefix and Tailwind's variant markers alone", async () => {
    const source = `<div className="group group/card peer hf-fx-node" />`;

    expect(await unresolved(new Map([["a.tsx", source]]))).toEqual([]);
  });

  it("claims nothing for a template chunk that touches an interpolation", async () => {
    expect(await unresolved(new Map([["a.tsx", "<div className={`w-${i}`} />"]]))).toEqual([]);
  });

  it("resolves every class Studio's own source claims", async () => {
    expect(await unresolved(studioSources())).toEqual([]);
  });
});
