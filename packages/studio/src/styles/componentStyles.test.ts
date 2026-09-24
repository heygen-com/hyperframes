/** Guards the split between Studio's app sheet and the component rules an embedder imports. */

import { readFileSync } from "node:fs";
import path from "node:path";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";
import { extractClassCandidates } from "./classCandidates";
import { listSourceFiles, loadStylesheet, STYLES_DIR } from "./styleSources";

/** Class names a stylesheet's own selectors name. */
function selectorClasses(css: string): Set<string> {
  let selectors = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (let previous = ""; previous !== selectors; ) {
    previous = selectors;
    selectors = selectors.replace(/\{[^{}]*\}/g, ";");
  }
  return new Set([...selectors.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]));
}

function classesStudioRenders(): Set<string> {
  const classes = new Set<string>();
  const sources = listSourceFiles((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));
  for (const source of sources.values()) {
    for (const candidate of extractClassCandidates(source)) classes.add(candidate.base);
  }
  return classes;
}

describe("studio component styles", () => {
  it("keeps every class Studio renders out of the app-only sheet", () => {
    const rendered = classesStudioRenders();
    expect(rendered).toContain("timeline-clip__label");

    const appSheet = readFileSync(path.join(STYLES_DIR, "studio.css"), "utf8");
    const appOnly = [...selectorClasses(appSheet)].filter((name) => rendered.has(name));

    expect(appOnly, "move these rules to components.css").toEqual([]);
  });

  it("gives an embedder the timeline rules from theme.css and components.css alone", async () => {
    const entry = '@import "tailwindcss";\n@import "./theme.css";\n@import "./components.css";';
    const css = (await compile(entry, { base: STYLES_DIR, loadStylesheet })).build([]);

    expect(css).toMatch(/^\s*\.timeline-clip__label \{/m);
    expect(css).not.toContain("#root");
  });
});
