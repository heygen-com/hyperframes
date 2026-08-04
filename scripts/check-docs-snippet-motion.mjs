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

/**
 * Split a snippet into its exported components.
 *
 * The invariant is per component, not per file: `docs-video.jsx` already holds
 * two, so a whole-file match lets a second unguarded grid ride in on the first
 * one's guard.
 */
export function splitComponents(source) {
  const starts = [...source.matchAll(/^(?:export\s+)?(?:const|function)\s+(\w+)\s*[=(]/gm)];
  return starts.map((match, index) => ({
    name: match[1],
    body: source.slice(match.index, starts[index + 1]?.index ?? source.length),
  }));
}

/**
 * A component needs the guard only if it *decides* to autoplay.
 *
 * `DocsVideo` forwards its caller's `autoPlay` prop and only ever plays because
 * a reader clicked, so it is not the component that owes a preference check —
 * whoever passes the prop is.
 */
export function autoplays(source) {
  const decidedElsewhere = source
    // Forwarding the caller's prop.
    .replace(/autoPlay=\{\s*autoPlay\s*\}/g, "")
    // The prop's own default in the signature, which is a declaration, not a use.
    .replace(/\bautoPlay\s*=\s*(?:true|false)\s*(?=[,}])/g, "");
  return /\bautoPlay(?=[\s/>=])/.test(decidedElsewhere);
}

/** The text between the parentheses of one `useState(` call. */
function argumentAt(source, openParen) {
  let depth = 0;
  let index = openParen;
  do {
    depth += Number(source[index] === "(") - Number(source[index] === ")");
    index += 1;
  } while (depth > 0 && index < source.length);
  return source.slice(openParen + 1, index - 1);
}

/**
 * The preference must be known on the first render, and both halves have to be
 * the same expression. A lazy initializer for unrelated state, plus the media
 * query read in a mount effect, is the original bug — so the query has to sit
 * inside the initializer, not merely nearby.
 */
export function readsPreferenceLazily(source) {
  return [...source.matchAll(/useState\(/g)]
    .map((call) => argumentAt(source, call.index + "useState".length))
    .some(
      (argument) =>
        /^\s*\(\s*\)\s*=>/.test(argument) && argument.includes("prefers-reduced-motion"),
    );
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
      "reads prefers-reduced-motion after mount instead of inside a useState lazy initializer, " +
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
    .filter((name) => /\.(?:jsx|tsx)$/.test(name))
    .flatMap((name) =>
      splitComponents(readFileSync(join(dir, name), "utf8"))
        .filter((component) => autoplays(component.body))
        .map((component) => ({
          name,
          component: component.name,
          problems: findMotionGuardViolations(component.body),
        })),
    )
    .filter((finding) => finding.problems.length > 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const failures = auditSnippets();
  if (failures.length > 0) {
    console.error("Docs snippets that autoplay must honour prefers-reduced-motion:\n");
    for (const { name, component, problems } of failures) {
      for (const problem of problems)
        console.error(`  docs/snippets/${name} → ${component} — ${problem}`);
    }
    console.error("\nSee the header of scripts/check-docs-snippet-motion.mjs for why.");
    process.exit(1);
  }
}
