import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  auditSnippets,
  autoplays,
  findMotionGuardViolations,
  splitComponents,
} from "./check-docs-snippet-motion.mjs";

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

test("forwarding a caller's autoPlay prop does not make a component owe the guard", () => {
  assert.equal(autoplays('<video autoPlay={autoPlay} preload="metadata" />'), false);
  assert.equal(autoplays("({ autoPlay = false }) => <video autoPlay={autoPlay} />"), false);
  assert.equal(autoplays("<video autoPlay={!reduced} />"), true);
  assert.equal(autoplays('<video controls muted preload="metadata" />'), false);
});

test("every autoplaying component in docs/snippets currently satisfies the guard", () => {
  assert.deepEqual(auditSnippets(), []);
});
