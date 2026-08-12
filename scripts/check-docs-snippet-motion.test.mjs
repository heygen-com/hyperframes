import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  auditSnippets,
  autoplays,
  findMotionGuardViolations,
  splitComponents,
} from "./check-docs-snippet-motion.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const GUARDED = `export const Grid = () => {
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (!reducedMotion || !gridRef.current) return;
    for (const video of gridRef.current.querySelectorAll("video")) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
  }, [reducedMotion]);
  return <video autoPlay={!reducedMotion} />;
};
`;

test("a guarded component passes", () => {
  assert.deepEqual(findMotionGuardViolations(GUARDED), []);
});

test("reading the preference after mount is caught — the first-paint fetch", () => {
  const lateRead = GUARDED.replace(
    /const \[reducedMotion[\s\S]*?\);\n/,
    "const [reducedMotion, setReducedMotion] = useState(false);\n",
  );
  const problems = findMotionGuardViolations(lateRead);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /lazy initializer/);
});

test("false -> true with no active stop is caught", () => {
  const noStop = GUARDED.replace(/\s*video\.pause\(\);[\s\S]*?video\.load\(\);/, "");
  const problems = findMotionGuardViolations(noStop);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /does not pause an element or abort its resource/);
});

test("dropping only load() is still caught", () => {
  assert.equal(findMotionGuardViolations(GUARDED.replace("      video.load();\n", "")).length, 1);
});

// Both gaps below were found by review on #2977, against an earlier whole-file
// version of this check that passed all of the cases above.

test("a lazy initializer for unrelated state does not satisfy the preference read", () => {
  const decoupled = GUARDED.replace(
    /const \[reducedMotion[\s\S]*?\);\n/,
    "const [id] = useState(() => makeId());\n  const [reducedMotion, setReducedMotion] = useState(false);\n" +
      '  useEffect(() => setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches), []);\n',
  );
  const problems = findMotionGuardViolations(decoupled);
  assert.equal(
    problems.length,
    1,
    "a lazy initializer anywhere must not vouch for the media query",
  );
  assert.match(problems[0], /lazy initializer/);
});

test("a second unguarded component cannot ride in on the first one's guard", () => {
  const twoComponents = `${GUARDED}
export const OtherGrid = () => {
  return <video autoPlay={true} />;
};
`;
  const components = splitComponents(twoComponents);
  assert.deepEqual(
    components.map((component) => component.name),
    ["Grid", "OtherGrid"],
  );
  assert.deepEqual(findMotionGuardViolations(components[0].body), []);
  assert.equal(findMotionGuardViolations(components[1].body).length, 2);
});

// Both below were found by running these functions rather than reading them,
// on the approval pass for #2977. Each fails silently: a component that
// `autoplays` misses is filtered out before any requirement runs, so the gate
// reports zero problems instead of a violation.

test("a bare autoPlay attribute counts, however the element is wrapped", () => {
  assert.equal(autoplays("<video autoPlay muted />"), true);
  assert.equal(autoplays("<video src={s} autoPlay/>"), true);
  assert.equal(autoplays("<video\n  autoPlay\n/>"), true);
});

test("a component that is not exported cannot inherit the one above it", () => {
  const sneaky = `${GUARDED}
const Sneaky = () => <video autoPlay={true} />;
`;
  const components = splitComponents(sneaky);
  assert.deepEqual(
    components.map((component) => component.name),
    ["Grid", "Sneaky"],
  );
  assert.equal(findMotionGuardViolations(components[1].body).length, 2);
});

test("forwarding a caller's autoPlay prop does not make a component owe the guard", () => {
  assert.equal(autoplays('<video autoPlay={autoPlay} preload="metadata" />'), false);
  assert.equal(autoplays("({ autoPlay = false }) => <video autoPlay={autoPlay} />"), false);
  assert.equal(
    autoplays("({ autoPlay = false, loop = false }) => <video autoPlay={autoPlay} />"),
    false,
  );
  assert.equal(autoplays("<video autoPlay={!reduced} />"), true);
  assert.equal(autoplays('<video controls muted preload="metadata" />'), false);
});

test("every autoplaying component in docs/snippets currently satisfies the guard", () => {
  assert.deepEqual(auditSnippets(), []);
});

// Reduced motion disables autoplay, but the visible control must still start the
// whole comparison — not just the reference — or a reduced-motion visitor who
// presses it sees half the pair. Source-level, since the repo has no React
// runtime harness for docs snippets (this whole check is source-level for that
// reason).
test("ReplicaCompare's control starts both films and does not gate sync on reduced motion", () => {
  const source = readFileSync(join(here, "../docs/snippets/replica-compare.jsx"), "utf8");
  // startBoth must play both elements...
  const startBoth = source.match(/const startBoth = \(\) => \{([\s\S]*?)\n {2}\};/);
  assert.ok(startBoth, "found startBoth");
  assert.match(startBoth[1], /refVideo\.current\?\.play\(\)/, "reference is started");
  assert.match(startBoth[1], /repVideo\.current\?\.play\(\)/, "replica is started too");
  // ...and the voluntary-play control must actually route through it, not play
  // the reference alone (scoped to toggleSound so a helper left defined but
  // unused can't satisfy the check — the exact regression this guards).
  const toggle = source.match(/const toggleSound = \(\) => \{([\s\S]*?)\n {2}\};/);
  assert.ok(toggle, "found toggleSound");
  assert.match(toggle[1], /startBoth\(\)/, "voluntary play goes through startBoth");
  // The replica-sync effect attaches in view regardless of the preference, so a
  // voluntary play under reduced motion still pulls the replica along.
  const syncGate = source.match(/const b = repVideo\.current;\s*\n\s*if \(([^)]*)\) return;/);
  assert.ok(syncGate, "found the replica-sync guard");
  assert.doesNotMatch(syncGate[1], /reduced/, "sync must not early-return on reduced motion");
  // Offscreen release must reset the control's state, or a card unmuted before it
  // scrolled away returns reading "Sound on" over a paused, sourceless pair.
  const teardown = source.match(/if \(!inView\) \{([\s\S]*?)return;\n {4}\}/);
  assert.ok(teardown, "found the offscreen teardown");
  assert.match(teardown[1], /setMuted\(true\)/, "offscreen release resets muted state");
});

// 40 of HoverVideo's 53 uses sit inside a link (11 of 23 examples cards are
// <a href>, 29 of 30 thirty-days cards are <Card href>). Its control's click must
// not bubble to that link, or pressing it — mouse or keyboard — navigates away
// instead of toggling sound. This bug escaped static review and the gate; it only
// surfaced by driving the live preview, so pin it.
test("HoverVideo's control does not bubble its click to a wrapping link", () => {
  const source = readFileSync(join(here, "../docs/snippets/hover-video.jsx"), "utf8");
  const onClick = source.match(/onClick=\{\(e\) => \{([\s\S]*?)\n {8}\}\}/);
  assert.ok(onClick, "found the control's click handler");
  assert.match(onClick[1], /e\.preventDefault\(\)/, "default navigation is prevented");
  assert.match(
    onClick[1],
    /e\.stopPropagation\(\)/,
    "the click does not bubble to a wrapping link",
  );
});
