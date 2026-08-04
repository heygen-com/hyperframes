/**
 * Docs snippets that autoplay preview loops must honour prefers-reduced-motion
 * on BOTH edges, and the guard cannot be shared as code.
 *
 * Mintlify compiles each file in `docs/snippets/` in isolation and forbids one
 * snippet importing another, so the guard is necessarily copy-pasted into every
 * grid that autoplays. A duplicated invariant is exactly the kind that rots, so
 * it is asserted here instead.
 *
 * Two distinct failures, both real, both found in review on #2977:
 *
 *   First paint — `useState(false)` plus a `matchMedia` read in an effect means
 *   the first committed render emits `<video src autoPlay loop>` and only then
 *   pulls the attributes. `autoPlay` overrides `preload="metadata"`, so those
 *   are the files, not metadata probes. A lazy initializer knows on render one.
 *
 *   Runtime change — dropping `src` and `autoPlay` via React props neither
 *   pauses a playing element nor aborts its selected resource: a media element
 *   keeps its resource until the load algorithm is re-invoked, and `autoplay`
 *   only governs the first play. Turning Reduce Motion on mid-session would
 *   otherwise leave every tile playing and downloading.
 *
 * A rendering test would mean adding React to a repository that only carries it
 * inside `packages/studio`, and mocking Mintlify's hook-injection contract — a
 * mock that can stay green while the real page breaks. This asserts the source
 * instead, which is what actually regresses.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SNIPPETS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "docs", "snippets");

/** A file needs the guard only if it autoplays something. */
export function autoplays(source) {
  return /\bautoPlay(?:=\{|\s|\/?>)/.test(source);
}

/** The preference must be known on the first render, not after the first effect. */
export function readsPreferenceLazily(source) {
  return /useState\(\s*\(\)\s*=>/.test(source) && source.includes("prefers-reduced-motion");
}

/** React props alone neither pause an element nor abort its resource. */
export function stopsPlaybackActively(source) {
  return (
    source.includes(".pause()") &&
    source.includes(".load()") &&
    /removeAttribute\(\s*"src"/.test(source)
  );
}

const REQUIREMENTS = [
  {
    holds: readsPreferenceLazily,
    problem:
      "reads prefers-reduced-motion after mount instead of in a useState lazy initializer, " +
      "so the first committed render autoplays before the preference is known",
  },
  {
    holds: stopsPlaybackActively,
    problem:
      "never actively stops playback when the preference flips to reduce; " +
      "dropping src/autoPlay through React props does not pause an element or abort its resource — " +
      'pause(), removeAttribute("src") and load() are all required',
  },
];

export function findMotionGuardViolations(source) {
  return REQUIREMENTS.filter((rule) => !rule.holds(source)).map((rule) => rule.problem);
}

export function auditSnippets(dir = SNIPPETS_DIR) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".jsx") || name.endsWith(".tsx"))
    .map((name) => ({ name, source: readFileSync(join(dir, name), "utf8") }))
    .filter(({ source }) => autoplays(source))
    .map(({ name, source }) => ({ name, problems: findMotionGuardViolations(source) }))
    .filter(({ problems }) => problems.length > 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const failures = auditSnippets();
  if (failures.length > 0) {
    console.error("Docs snippets that autoplay must honour prefers-reduced-motion:\n");
    for (const { name, problems } of failures) {
      for (const problem of problems) console.error(`  docs/snippets/${name} — ${problem}`);
    }
    console.error("\nSee the header of scripts/check-docs-snippet-motion.mjs for why.");
    process.exit(1);
  }
}
